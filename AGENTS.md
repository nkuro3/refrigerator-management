# 冷蔵庫管理アプリ（AGENTS.md）

家族で冷蔵庫・食品ストックを共有し、使い切りを助けるアプリ。仕様書: https://claude.ai/code/artifact/42cfd838-8336-4477-871d-622f9ca2c904

## 構成

| パス | 内容 |
| --- | --- |
| `apps/mobile` | Expo（SDK 57・Expo Router）アプリ。Web 版（PWA）も同じコードから出力し Cloudflare Pages で公開する。Expo 固有のルールは `apps/mobile/AGENTS.md` |
| `packages/shared` | アプリ用の型・表示ラベル・期限表示や並び替え・登録ペイロード生成（純粋関数＋Vitest） |
| `supabase/migrations` | スキーマ・RLS・RPC・トリガー・初期品目マスタ |
| `supabase/functions` | Edge Functions（Deno）: `analyze-purchase`（OpenAI gpt-6-luna で画像から抽出 → TypeSafe Jev で品目を判定）、`expiry-alerts`（毎時の使い切りアラート） |
| `supabase/tests` | ローカル Postgres でマイグレーションを検証するテスト |

## コマンド

```bash
bun install
bun run typecheck      # 全ワークスペースの型チェック
bun run lint
bun run test           # shared と Edge Functions の純粋関数のテスト
PGURL=postgres://postgres@localhost:5432/postgres bun run test:db   # マイグレーションのテスト（Postgres 16+）
(cd supabase/functions/analyze-purchase && deno check index.ts)     # Edge Function の型チェック
```

## ルール

- 業務ロジックの多くは DB 側にある: 期限の推定・状態変化のイベント記録・登録時の買い物リスト連動はトリガー、まとめ登録は `register_purchase` RPC。変更したら `supabase/tests/core_test.sql` にテストを足して `test:db` を通す。
- 既存のマイグレーションは書き換えず、新しいファイルを追加する。
- AI 判定の結果型は `supabase/functions/analyze-purchase/normalize.ts` と `packages/shared/src/types.ts` の両方を揃える（Edge Function は Deno なので共有パッケージを import しない）。
- Edge Functions の各ディレクトリにある `deno.json`（`nodeModulesDir: none`）は消さない。ルートの `package.json` と `node_modules` を Deno が拾うのを防いでいる。
- Expo のパッケージは `bunx expo install` で追加する。依存は `bunfig.toml` の hoisted 配置（ネイティブモジュールの重複防止）。
- Web 版と共通のコードで、Web だけ挙動が違う部分は `*.web.ts` に分ける（例: `src/lib/push.web.ts` は Web Push、`push.ts` は Expo の通知）。公開する関数の形は両方で揃える。react-native の `Alert` は Web で表示されないので `src/lib/confirm.ts` を使う。
- Web 版は `bun run build:web`（apps/mobile）でビルドできることを確認する。PWA の設定は `apps/mobile/public/`（index.html・manifest.json・sw.js・_headers）。
- インフラは無料枠で運用する前提（Supabase Free / Expo Free）。AI の API（OpenAI・TypeSafe）は従量課金。画像は長辺1280pxの JPEG に圧縮し、レシート画像は登録後に削除する。
