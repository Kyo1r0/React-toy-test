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
const WEATHER_BASE = 'https://weather.tsukumijima.net/api/forecast/city';

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
    method: 'POST',
    path: '/api/square',
    summary: '数字を送ると2乗して返す。POSTは情報をURLではなくボディに入れる。',
    example: '/api/square',
    sampleBody: { number: 7 },
    handler: (ctx) => {
      const number = ctx.body && ctx.body.number;
      // 送られてきたものが本当に数字か、サーバー側で必ず確かめる
      if (typeof number !== 'number' || !Number.isFinite(number)) {
        return {
          status: 400,
          body: {
            error: {
              code: 'NUMBER_REQUIRED',
              message: 'number には数値を入れてください（"7" のような文字列はダメ）',
              received: number === undefined ? null : number,
            },
          },
        };
      }
      return { status: 200, body: { number, squared: number * number } };
    },
  },

  {
    method: 'GET',
    path: '/api/weather',
    hidden: true,
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
    hidden: true,
    handler: () => {
      return {
        status: 200,
        body: {
          routes: routes.map((r) => ({
            method: r.method,
            path: r.path,
            summary: r.summary,
            example: r.example,
            sampleBody: r.sampleBody || null,
            hidden: Boolean(r.hidden),
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

/** メソッドとパスの両方が一致する route を探す。両方揃って初めて「同じ窓口」 */
function findRoute(method, pathname) {
  return routes.find((r) => r.method === method && r.path === pathname);
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
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
  }

  // ブラウザが勝手に取りに来るので、ログを汚さないよう黙って 204 を返す
  if (url.pathname === '/favicon.ico') return sendJson(res, 204, null);

  if (!url.pathname.startsWith('/api/')) {
    return serveStatic(req, res, url.pathname);
  }

  const route = findRoute(req.method, url.pathname);
  if (!route) {
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
    const result = await route.handler({
      query: url.searchParams,
      headers: req.headers,
      body,
    });
    sendJson(res, result.status, result.body, result.headers);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// 既に3000番で何かが動いていると listen できずに落ちるので、理由を説明して終わる
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error('');
  console.error(`  ポート ${PORT} は既に他のプロセスが使っています。`);
  console.error('  先に起動しているサーバーを止めるか、別のポートで起動してください:');
  console.error('');
  console.error('    PowerShell : $env:PORT=3001; node api-lab/server.js');
  console.error('    Git Bash   : PORT=3001 node api-lab/server.js');
  console.error('');
  process.exit(1);
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
