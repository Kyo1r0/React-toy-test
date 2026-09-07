'use strict';

/**
 * 画面側のスクリプト。
 * やっていることは一つだけ: fetch() でリクエストを投げ、
 * 「送ったもの」と「返ってきたもの」を分解して画面に出す。
 */

const $ = (sel, root = document) => root.querySelector(sel);
const WEATHER_BASE = 'https://weather.tsukumijima.net/api/forecast/city';

const STATUS = {
  200: ['OK', '成功。ボディに結果が入っている'],
  201: ['Created', '作成に成功。Location ヘッダーに新しいURLが入る'],
  204: ['No Content', '成功したが返す中身は無い'],
  304: ['Not Modified', '前と同じなのでキャッシュを使ってよい'],
  400: ['Bad Request', 'リクエストの形が間違っている（頼んだ側のミス）'],
  401: ['Unauthorized', '合言葉（認証情報）が足りない'],
  403: ['Forbidden', '権限が無い'],
  404: ['Not Found', 'その住所には何も無い'],
  500: ['Internal Server Error', 'サーバーの中でエラーが起きた'],
  502: ['Bad Gateway', '中継先（上流API）から正しい返事が得られなかった'],
};

const esc = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---------------------------------------------------------------------------
// 通信ログ
// ---------------------------------------------------------------------------
function pushLog(actor, method, url, status, ms) {
  const list = $('#log-list');
  const li = document.createElement('li');
  const cls = status >= 500 ? 's5' : status >= 400 ? 's4' : 's2';
  li.innerHTML =
    `<div><span class="who">${esc(actor)}</span> ${new Date().toLocaleTimeString('ja-JP')}</div>` +
    `<div class="u">${esc(method)} ${esc(url)}</div>` +
    `<div><span class="st ${cls}">${status}</span> · ${ms}ms</div>`;
  list.prepend(li);
  list.classList.remove('empty');
}

// ---------------------------------------------------------------------------
// 「リクエスト / レスポンス」パネルの組み立て
// ---------------------------------------------------------------------------
function statusClass(s) {
  return s >= 500 ? 's5' : s >= 400 ? 's4' : 's2';
}

function requestText(method, urlStr, headers, body) {
  const u = new URL(urlStr, location.origin);
  const lines = [`${method} ${u.pathname}${u.search} HTTP/1.1`, `Host: ${u.host}`];
  for (const [k, v] of Object.entries(headers || {})) lines.push(`${k}: ${v}`);
  let text = lines.join('\n');
  if (body) text += `\n\n${body}`;
  return text;
}

function responseText(status, headerPairs, bodyText) {
  const meta = STATUS[status] || ['', ''];
  const lines = [`HTTP/1.1 ${status} ${meta[0]}`];
  for (const [k, v] of headerPairs) lines.push(`${k}: ${v}`);
  return `${lines.join('\n')}\n\n${bodyText}`;
}

/** 1往復ぶんのパネルHTMLを作る */
function exchangeHtml(ex) {
  const meta = STATUS[ex.status] || ['', '（このコードの説明は早見表を見てください）'];
  const notes = (ex.notes || []).map((n) => `<p class="pane-note">${n}</p>`).join('');
  return `
    <div class="exchange">
      <div class="pane">
        <h4><span>▶ 送ったリクエスト</span><span>${esc(ex.label || '')}</span></h4>
        <pre class="head">${esc(ex.request)}</pre>
      </div>
      <div class="pane">
        <h4>
          <span>◀ 返ってきたレスポンス</span>
          <span><span class="st ${statusClass(ex.status)}">${ex.status} ${esc(meta[0])}</span> · ${ex.ms}ms</span>
        </h4>
        <pre>${esc(ex.response)}</pre>
        <p class="pane-note"><strong>${ex.status}</strong> = ${esc(meta[1])}</p>
        ${notes}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// 1. 外部API（天気予報API）
// ---------------------------------------------------------------------------
function currentRouteMode() {
  return document.querySelector('input[name=route]:checked').value;
}

function updateRouteDiagram() {
  const mode = currentRouteMode();
  const d = $('#route-diagram');
  const on = (hop, yes) => d.querySelector(`[data-hop="${hop}"]`).classList.toggle('on', yes);
  on('browser', true);
  on('upstream', true);
  on('server', mode === 'proxy');
  on('hop1', mode === 'proxy');
  on('hop2', mode === 'proxy');

  if (mode === 'direct') {
    d.querySelector('[data-hop="hop1"] .arrow-line').textContent = '';
    d.querySelector('[data-hop="hop2"] .arrow-line').textContent = '─────────▶';
    d.querySelector('[data-hop="hop2"]').classList.add('on');
    $('#route-note').innerHTML =
      'ブラウザのJavaScriptが、天気予報APIを<strong>直接</strong>呼びます。速いが、相手が許可（CORS）していないと使えません。';
  } else {
    d.querySelector('[data-hop="hop1"] .arrow-line').textContent = '──▶';
    d.querySelector('[data-hop="hop2"] .arrow-line').textContent = '──▶';
    $('#route-note').innerHTML =
      'ブラウザは<strong>自分のサーバー</strong>に頼み、サーバーが代わりに天気予報APIを呼びます（プロキシ）。往復は2回に増えますが、CORSの制限を受けず、APIキーも隠せます。';
  }
}

async function sendWeather() {
  const btn = $('#send-weather');
  const city = $('#city').value;
  const cityName = $('#city').selectedOptions[0].textContent;
  const mode = currentRouteMode();
  const box = $('#weather-exchange');

  btn.disabled = true;
  box.innerHTML = '<p class="note">送信中…</p>';
  $('#weather-result').innerHTML = '';

  try {
    if (mode === 'direct') {
      const url = `${WEATHER_BASE}/${city}`;
      const t0 = performance.now();
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      const ms = Math.round(performance.now() - t0);
      const headers = [...res.headers.entries()];
      pushLog('ブラウザ → 天気予報API', 'GET', url, res.status, ms);

      box.innerHTML = exchangeHtml({
        label: 'ブラウザ → 天気予報API',
        request: requestText('GET', url, { Accept: 'application/json' }),
        status: res.status,
        ms,
        response: responseText(res.status, headers, text),
        notes: [
          `ブラウザから読めたレスポンスヘッダーは <strong>${headers.length}個</strong>だけです。` +
            'CORSのルールにより、JavaScriptからは限られたヘッダーしか見えません。' +
            '実際にはもっと多くのヘッダーが返ってきています（「自分のサーバー経由」で送り直すと全部見えます）。',
          'このAPIは <code>Access-Control-Allow-Origin: *</code> を返しているので直接呼べます。' +
            'これが無いAPIは、通信自体は成功してもブラウザが結果をJavaScriptに渡してくれません（CORSエラー）。',
        ],
      });
      renderWeather(JSON.parse(text), cityName);
    } else {
      const url = `/api/weather?city=${encodeURIComponent(city)}`;
      const t0 = performance.now();
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      const ms = Math.round(performance.now() - t0);
      const json = JSON.parse(text);
      pushLog('ブラウザ → 自分のサーバー', 'GET', url, res.status, ms);

      let html = '<h3>① ブラウザ → 自分のサーバー</h3>';
      html += exchangeHtml({
        label: '同じオリジンなのでCORSは関係ない',
        request: requestText('GET', url, { Accept: 'application/json' }),
        status: res.status,
        ms,
        response: responseText(res.status, [...res.headers.entries()], text),
      });

      if (json.upstream) {
        pushLog('サーバー → 天気予報API', 'GET', json.upstream.url, json.upstream.status, json.upstream.elapsedMs);
        html += '<h3>② サーバー → 天気予報API（サーバーの中で起きたこと）</h3>';
        html += exchangeHtml({
          label: 'server.js の fetch()',
          request: requestText('GET', json.upstream.url, { Accept: 'application/json' }),
          status: json.upstream.status,
          ms: json.upstream.elapsedMs,
          response: responseText(
            json.upstream.status,
            Object.entries(json.upstream.headers),
            '（本文は①のレスポンスの data に入っています）'
          ),
          notes: [
            `サーバー同士の通信なので、ヘッダーが <strong>${Object.keys(json.upstream.headers).length}個</strong>すべて見えています。` +
              '「直接」で送ったときと数を比べてみてください。',
          ],
        });
      }
      box.innerHTML = html;
      if (json.data) renderWeather(json.data, cityName);
    }
  } catch (err) {
    box.innerHTML = `<p class="pane-note">通信に失敗しました: ${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
}

/** 生JSONを人間向けに整形して表示する = これがクライアントの仕事 */
function renderWeather(data, cityName) {
  if (!data || !data.forecasts) return;
  const cards = data.forecasts
    .map((f) => {
      const max = (f.temperature.max && f.temperature.max.celsius) || '--';
      const min = (f.temperature.min && f.temperature.min.celsius) || '--';
      return `<div class="wx-card">
        <div class="d">${esc(f.dateLabel)} <small>${esc(f.date)}</small></div>
        <img src="${esc(f.image.url)}" alt="${esc(f.telop)}">
        <div class="t">${esc(f.telop)}</div>
        <div class="tmp">最高 ${esc(max)}℃ / 最低 ${esc(min)}℃</div>
      </div>`;
    })
    .join('');
  $('#weather-result').innerHTML =
    `<p class="wx-title"><strong>${esc(data.title)}</strong>（発表: ${esc(data.publicTimeFormatted)} ${esc(data.publishingOffice)}）</p>` +
    `<div class="wx">${cards}</div>` +
    `<p class="note">↑ これは下の生JSONの <code>forecasts</code> を並べ替えただけ。` +
    `<strong>APIはデータだけを返し、見た目を作るのはクライアントの仕事</strong>です。（${esc(cityName)}）</p>`;
}

// ---------------------------------------------------------------------------
// 2. 自作API
// ---------------------------------------------------------------------------
let routeMeta = [];

async function loadRoutes() {
  const t0 = performance.now();
  const res = await fetch('/api/__routes');
  const json = await res.json();
  pushLog('ブラウザ → 自分のサーバー', 'GET', '/api/__routes', res.status, Math.round(performance.now() - t0));

  routeMeta = json.routes;
  // hidden(= 天気の中継役や、この一覧自身)は、練習用の一覧には出さない
  $('#endpoint-list').innerHTML = routeMeta
    .map((r, i) => ({ r, i }))
    .filter((x) => !x.r.hidden)
    .map(
      ({ r, i }) => `<button class="ep" data-i="${i}">
        <span class="m ${r.method}">${r.method}</span>
        <span class="p">${esc(r.path)}</span>
        <span class="s">${esc(r.summary)}</span>
      </button>`
    )
    .join('');

  $('#endpoint-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.ep');
    if (!btn) return;
    const r = routeMeta[Number(btn.dataset.i)];
    $('#req-method').value = r.method;
    $('#req-path').value = r.example;
    $('#req-body').value = r.sampleBody ? JSON.stringify(r.sampleBody, null, 2) : '';
    syncBodyVisibility();
  });
}

function syncBodyVisibility() {
  $('#body-wrap').hidden = $('#req-method').value === 'GET';
}

/** 実際に呼ばれた handler のソースを探す（説明表示用） */
function findMeta(method, pathname) {
  return routeMeta.find((r) => r.method === method && r.path === pathname);
}

async function sendOwn() {
  const btn = $('#send-own');
  const method = $('#req-method').value;
  const pathStr = $('#req-path').value.trim();
  const headers = { Accept: 'application/json' };

  let body;
  if (method !== 'GET' && $('#req-body').value.trim()) {
    body = $('#req-body').value.trim();
    headers['Content-Type'] = 'application/json';
  }

  btn.disabled = true;
  $('#own-exchange').innerHTML = '<p class="note">送信中…</p>';
  $('#own-source').innerHTML = '';

  try {
    const t0 = performance.now();
    const res = await fetch(pathStr, { method, headers, body });
    const text = await res.text();
    const ms = Math.round(performance.now() - t0);
    pushLog('ブラウザ → 自分のサーバー', method, pathStr, res.status, ms);

    $('#own-exchange').innerHTML = exchangeHtml({
      label: 'server.js が応答',
      request: requestText(method, pathStr, headers, body),
      status: res.status,
      ms,
      response: responseText(
        res.status,
        [...res.headers.entries()],
        text || '（本文なし）'
      ),
    });

    const meta = findMeta(method, new URL(pathStr, location.origin).pathname);
    $('#own-source').innerHTML = meta
      ? `<details class="source-panel" open>
           <summary>このレスポンスを作ったサーバー側のコード（${esc(meta.method)} ${esc(meta.path)}）</summary>
           <pre>${esc(meta.source)}</pre>
         </details>`
      : `<p class="note">この URL に対応する処理はサーバーにありません。だから <code>404</code> が返りました。</p>`;
  } catch (err) {
    $('#own-exchange').innerHTML = `<p class="pane-note">通信に失敗しました: ${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// 初期化
// ---------------------------------------------------------------------------
$('#log-list').classList.add('empty');
document.querySelectorAll('input[name=route]').forEach((r) => r.addEventListener('change', updateRouteDiagram));
$('#send-weather').addEventListener('click', sendWeather);
$('#send-own').addEventListener('click', sendOwn);
$('#req-method').addEventListener('change', syncBodyVisibility);
$('#req-path').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendOwn(); });

updateRouteDiagram();
syncBodyVisibility();
loadRoutes();
