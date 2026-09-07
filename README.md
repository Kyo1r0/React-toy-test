


```
izzbuzz-study/
├── package.json              workspaces 定義 + まとめて起動する scripts
├── tsconfig.base.json
├── .env.example
├── README.md
│
├── openapi/
│   ├── public.yaml           React ↔ API サーバー
│   └── internal.yaml         API ↔ FizzBuzz サーバー
│
├── shared/                   3つで共有する型だけ
│   ├── package.json
│   └── src/
│       ├── index.ts
│       └── types.ts          Settings / NumberRecord / ApiError / FizzBuzzItem
│
├── fizzbuzz/                 :3002
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts          起動のみ
│       ├── app.ts            ルーティング組み立て
│       ├── schema.ts         zod でリクエスト検証
│       ├── routes/
│       │   ├── fizzbuzz.ts   POST /internal/fizzbuzz
│       │   └── health.ts     GET /internal/health
│       ├── core/
│       │   ├── generate.ts   純粋関数。ロジックは全部ここ
│       │   └── generate.test.ts
│       └── middleware/
│           ├── auth.ts       共有トークン検証
│           └── errorHandler.ts
│
├── api/                      :3001
│   ├── package.json
│   ├── tsconfig.json
│   ├── data/app.db           gitignore 対象
│   └── src/
│       ├── index.ts
│       ├── app.ts
│       ├── config.ts         env 読み込み(FIZZBUZZ_URL, TOKEN, HARD_MAX)
│       ├── schema.ts
│       ├── routes/
│       │   ├── numbers.ts
│       │   └── settings.ts
│       ├── services/
│       │   ├── numberService.ts      保存時バリデーション
│       │   ├── settingsService.ts    ハードリミット検証
│       │   └── fizzbuzzService.ts    ページング→start/end 算出→上流呼び出し
│       ├── clients/
│       │   └── fizzbuzzClient.ts     fetch + timeout + 502/504 への変換
│       ├── db/
│       │   ├── index.ts
│       │   ├── schema.sql
│       │   ├── migrate.ts
│       │   ├── seed.ts               settings の id=1 を投入
│       │   └── repositories/
│       │       ├── numberRepository.ts
│       │       └── settingsRepository.ts
│       ├── errors/
│       │   ├── AppError.ts
│       │   └── codes.ts              VALUE_OUT_OF_RANGE など
│       └── middleware/
│           └── errorHandler.ts
│
└── web/                      :5173
    ├── package.json
    ├── vite.config.ts        /api を 3001 に proxy
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx           3画面のルーティング
        ├── api/
        │   ├── client.ts     fetch ラッパ。error.code を throw し直す
        │   ├── numbers.ts
        │   └── settings.ts
        ├── pages/
        │   ├── SaveNumberPage.tsx
        │   ├── FizzBuzzPage.tsx
        │   └── SettingsPage.tsx
        ├── components/
        │   ├── ErrorMessage.tsx
        │   └── Pagination.tsx
        └── hooks/
            └── useSettings.ts


```