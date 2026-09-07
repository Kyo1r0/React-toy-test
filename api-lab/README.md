# API体験ラボ

「APIとは何か」を、実際にAPIを呼びながら説明するWebアプリ。
**依存パッケージゼロ**（Node.js 標準の `http` モジュールと `fetch` だけ）。

## 起動

```bash
node api-lab/server.js
```

→ http://localhost:3000 を開く。ポートを変えたいときは `PORT=8080 node api-lab/server.js`。

## 何が見えるか

画面のボタンを押すと本当にHTTP通信が起き、**送ったリクエストと返ってきたレスポンスを生のまま**左右に並べて表示する。
ブラウザ側の「通信ログ」と、サーバーを起動したターミナルのログを見比べると、同じ1回の通信を両側から見ていることがわかる。

### 1. 他人のAPIをGETする

[weather.tsukumijima.net](https://weather.tsukumijima.net/) の天気予報API（登録不要）を叩く。
2つの経路を切り替えて比較できる。

| | ブラウザから直接 | 自分のサーバー経由 |
|---|---|---|
| 往復 | 1回 | 2回 |
| 読めるレスポンスヘッダー | 2個（CORSの制限） | 14個すべて |
| CORS | 相手の許可が要る | 無関係 |

同じデータを取るのに見えるものが違う、というのがこのセクションの狙い。

### 2. 自作APIを自分で呼ぶ

`server.js` に書いたAPIをブラウザから叩く。エンドポイント一覧は決め打ちではなく
`GET /api/__routes` で取得している（APIの説明をAPIで配っている）。
呼んだあとに、**そのレスポンスを作った handler 関数のソースコードそのもの**が画面に出る
（`handler.toString()` をサーバーが返している）。

| メソッド | パス | 見せたいこと |
|---|---|---|
| GET | `/api/hello?name=` | クエリパラメータ |
| GET | `/api/dice?sides=&count=` | 入力チェックと `400` |
| GET | `/api/todos` | 一覧の取得 |
| POST | `/api/todos` | 作成 → `201` + `Location` ヘッダー |
| GET | `/api/todos/:id` | パスパラメータ / `404` |
| DELETE | `/api/todos/:id` | 削除 → `204`（本文なし） |
| GET | `/api/secret` | ヘッダーによる認証 / `401` |
| GET | `/api/weather?city=` | 外部APIへの中継（プロキシ） |
| GET | `/api/__routes` | 自己紹介 |

TODOはメモリ上に持っているだけなので、サーバーを再起動すると元に戻る。

## ファイル

```
api-lab/
├── server.js          APIの定義 + 静的配信 + 外部APIへの中継
└── public/
    ├── index.html     説明の本文
    ├── style.css
    └── app.js         fetch して、送受信の中身を分解して表示する
```

`server.js` の前半が「APIの定義」、後半が「URLと処理を繋ぐ配線」で分かれている。
まず前半だけ読めば、APIサーバーが何をしているかは掴める。
