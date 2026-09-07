'use strict';

/**
 * API体験ラボ ─ サーバー本体
 *
 * 依存パッケージゼロ。Node.js 標準の http モジュールだけで動く。
 * このファイルは 2 つの役割を持つ:
 *   1. public/ の中の HTML/CSS/JS を配る「Webサーバー」
 *   2. /api/... のリクエストに JSON を返す「APIサーバー」
 * さらに /api/weather では、外部API(天気予報API)を呼ぶ「中継役」もやる。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const API_KEY = 'mma-demo-key';
const WEATHER_BASE = 'https://weather.tsukumijima.net/api/forecast/city';

// ---------------------------------------------------------------------------
// サーバーがメモリ上に持っている「データベース」もどき。
// 再起動すると消える。APIが状態を持つ様子を見せるためだけのもの。
// ---------------------------------------------------------------------------
let todos = [
  { id: 1, title: 'APIの仕組みを理解する', done: false },
  { id: 2, title: '外部APIをGETしてみる', done: true },
];
let nextId = 3;

// ---------------------------------------------------------------------------
// 自作APIのルート定義。
// handler は ctx を受け取り { status, body, headers } を返すだけの関数。
// この関数のソースコードそのものを /api/__routes で配信して、
// 画面に「今あなたが呼んだ処理はこのコード」と並べて表示している。
// ---------------------------------------------------------------------------
const routes = [
  {
    method: 'GET',
    path: '/api/hello',
    summary: '名前を渡すと挨拶を返す。クエリパラメータ(?name=...)の練習。',
    example: '/api/hello?name=Kyo',
    handler: (ctx) => {
      const name = ctx.query.get('name') || 'ゲスト';
      return {
        status: 200,
        body: {
          message: `こんにちは、${name}さん！`,
          receivedQuery: Object.fromEntries(ctx.query),
          serverTime: new Date().toISOString(),
        },
      };
    },
  },

  {
    method: 'GET',
    path: '/api/dice',
    summary: 'サイコロを振る。変な値を渡すと 400 が返る = 入力チェックの例。',
    example: '/api/dice?sides=6&count=3',
    handler: (ctx) => {
      const sides = Number(ctx.query.get('sides') ?? 6);
      const count = Number(ctx.query.get('count') ?? 1);
      if (!Number.isInteger(sides) || sides < 2 || sides > 100) {
        return {
          status: 400,
          body: { error: { code: 'INVALID_PARAM', message: 'sides は 2〜100 の整数で指定してください' } },
        };
      }
      const rolls = Array.from(
        { length: Math.min(Math.max(count, 1), 10) },
        () => 1 + Math.floor(Math.random() * sides)
      );
      return { status: 200, body: { sides, rolls, total: rolls.reduce((a, b) => a + b, 0) } };
    },
  },

  {
    method: 'GET',
    path: '/api/todos',
    summary: 'TODO一覧を返す。GET = 取得。何回叩いても状態は変わらない。',
    example: '/api/todos',
    handler: () => {
      return { status: 200, body: { count: todos.length, items: todos } };
    },
  },

  {
    method: 'POST',
    path: '/api/todos',
    summary: 'TODOを1件追加する。POST = 作成。成功すると 201 と Location ヘッダーが返る。',
    example: '/api/todos',
    sampleBody: { title: 'POSTでデータを作ってみる' },
    handler: (ctx) => {
      const title = ctx.body && ctx.body.title;
      if (typeof title !== 'string' || title.trim() === '') {
        return {
          status: 400,
          body: { error: { code: 'TITLE_REQUIRED', message: 'title(文字列)が必要です' } },
        };
      }
      const todo = { id: nextId++, title: title.trim(), done: false };
      todos.push(todo);
      return { status: 201, body: todo, headers: { Location: `/api/todos/${todo.id}` } };
    },
  },

  {
    method: 'GET',
    path: '/api/todos/:id',
    summary: 'TODOを1件返す。URLの一部が変数(パスパラメータ)。無いIDなら 404。',
    example: '/api/todos/1',
    handler: (ctx) => {
      const todo = todos.find((t) => t.id === Number(ctx.params.id));
      if (!todo) {
        return {
          status: 404,
          body: { error: { code: 'NOT_FOUND', message: `id=${ctx.params.id} のTODOはありません` } },
        };
      }
      return { status: 200, body: todo };
    },
  },

  {
    method: 'DELETE',
    path: '/api/todos/:id',
    summary: 'TODOを削除する。成功しても本文は返さない = 204 No Content。',
    example: '/api/todos/1',
    handler: (ctx) => {
      const before = todos.length;
      todos = todos.filter((t) => t.id !== Number(ctx.params.id));
      if (todos.length === before) {
        return { status: 404, body: { error: { code: 'NOT_FOUND', message: '削除対象がありません' } } };
      }
      return { status: 204, body: null };
    },
  },

  {
    method: 'GET',
    path: '/api/secret',
    summary: '合言葉(APIキー)が要るエンドポイント。ヘッダーが無いと 401。',
    example: '/api/secret',
    needsKey: true,
    handler: (ctx) => {
      if (ctx.headers['x-api-key'] !== API_KEY) {
        return {
          status: 401,
          body: {
            error: {
              code: 'UNAUTHORIZED',
              message: 'X-Api-Key ヘッダーが必要です（このデモの合言葉は mma-demo-key）',
            },
          },
        };
      }
      return { status: 200, body: { message: '認証OK！ヘッダーは「誰が呼んだか」を伝える場所。' } };
    },
  },

  {
    method: 'GET',
    path: '/api/weather',
    summary: '外部APIを"サーバー経由"で呼ぶ中継役。上流の生の情報ごと返す。',
    example: '/api/weather?city=130010',
    handler: async (ctx) => {
      const city = ctx.query.get('city') || '130010';
      const upstreamUrl = `${WEATHER_BASE}/${encodeURIComponent(city)}`;
      const startedAt = Date.now();
      try {
        const upstream = await fetch(upstreamUrl, { headers: { Accept: 'application/json' } });
        const data = await upstream.json();
        return {
          status: upstream.status,
          body: {
            upstream: {
              url: upstreamUrl,
              status: upstream.status,
              elapsedMs: Date.now() - startedAt,
              // ブラウザから直接だと読めないヘッダーも、サーバー同士なら全部見える
              headers: Object.fromEntries(upstream.headers),
            },
            data,
          },
        };
      } catch (err) {
        return {
          status: 502,
          body: { error: { code: 'UPSTREAM_FAILED', message: `外部APIに繋がりませんでした: ${err.message}` } },
        };
      }
    },
  },

  {
    method: 'GET',
    path: '/api/__routes',
    summary: 'このサーバーが持つAPIの一覧（自己紹介）。handlerのソースも一緒に返す。',
    example: '/api/__routes',
    handler: () => {
      return {
        status: 200,
        body: {
          apiKeyForDemo: API_KEY,
          routes: routes.map((r) => ({
            method: r.method,
            path: r.path,
            summary: r.summary,
            example: r.example,
            sampleBody: r.sampleBody || null,
            needsKey: Boolean(r.needsKey),
            source: r.handler.toString(),
          })),
        },
      };
    },
  },
];

// ---------------------------------------------------------------------------
// ここから下は「配線」。URLと handler を繋ぐだけの部分。
// ---------------------------------------------------------------------------

/** GET /api/todos/3 のような具体URLを /api/todos/:id の定義に対応づける */
function matchRoute(method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const defined = route.path.split('/');
    const actual = pathname.split('/');
    if (defined.length !== actual.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < defined.length; i++) {
      if (defined[i].startsWith(':')) {
        params[defined[i].slice(1)] = decodeURIComponent(actual[i]);
      } else if (defined[i] !== actual[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

/** リクエストボディ(JSON)を読み切る */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('リクエストボディが正しいJSONではありません'));
      }
    });
  });
}

function sendJson(res, status, body, headers) {
  const base = Object.assign(
    {
      'X-Powered-By': 'api-lab (Node.js http module only)',
      'Access-Control-Allow-Origin': '*',
    },
    headers || {}
  );
  if (status === 204 || body === null) {
    res.writeHead(status, base);
    return res.end();
  }
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(
    status,
    Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
      },
      base
    )
  );
  res.end(payload);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^[/\\]+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: { code: 'FORBIDDEN' } });
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      return sendJson(res, 404, {
        error: { code: 'NOT_FOUND', message: `${pathname} というURLは存在しません` },
      });
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.on('finish', () => {
    const ms = Date.now() - startedAt;
    console.log(`${req.method} ${url.pathname}${url.search} -> ${res.statusCode} (${ms}ms)`);
  });

  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, null, {
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key',
    });
  }

  // ブラウザが勝手に取りに来るので、ログを汚さないよう黙って 204 を返す
  if (url.pathname === '/favicon.ico') return sendJson(res, 204, null);

  if (!url.pathname.startsWith('/api/')) {
    return serveStatic(req, res, url.pathname);
  }

  const hit = matchRoute(req.method, url.pathname);
  if (!hit) {
    return sendJson(res, 404, {
      error: {
        code: 'NO_SUCH_ENDPOINT',
        message: `${req.method} ${url.pathname} に対応する処理はありません`,
        hint: 'GET /api/__routes でエンドポイント一覧が見られます',
      },
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: { code: 'INVALID_JSON', message: err.message } });
  }

  try {
    const result = await hit.route.handler({
      query: url.searchParams,
      params: hit.params,
      headers: req.headers,
      body,
    });
    sendJson(res, result.status, result.body, result.headers);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  API体験ラボが起動しました');
  console.log(`  ->  http://localhost:${PORT}`);
  console.log('');
  console.log('  ブラウザで開いてリクエストを飛ばすと、');
  console.log('  ここ(ターミナル)にもサーバー側のログが出ます。');
  console.log('');
});
