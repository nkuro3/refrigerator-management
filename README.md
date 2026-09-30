# 冷蔵庫管理アプリ

家族で冷蔵庫・食品ストックを共有するアプリです。レシートと買ってきた食品をまとめて撮影すると、AI が商品を読み取り、品目を判定して一括登録します。期限3日以内と解凍済みの食品は毎日プッシュ通知で知らせ、使い切った量・捨てた量をダッシュボードで確認できます。

- 対応: iOS / Android（Expo）
- バックエンド: Supabase（Postgres・Auth・Storage・Realtime・Edge Functions・pg_cron）
- AI: 抽出は OpenAI gpt-6-luna（画像から商品名・個数・単価などを読み取る）、判定は TypeSafe Jev（品目マスタから品目を選ぶ）
- 仕様書: https://claude.ai/code/artifact/42cfd838-8336-4477-871d-622f9ca2c904

Supabase・Expo は無料枠で動きます。費用がかかるのは、AI の API（OpenAI と TypeSafe、どちらも従量課金で家族利用なら月数円程度）と、iPhone 配布用の Apple Developer Program（年額 $99）です。

## 必要なもの

- [Bun](https://bun.sh)
- Supabase アカウント（Free プラン）
- OpenAI の API キー（無料枠がないため、クレジットの購入が必要。月の使用上限を低めに設定しておく）
- TypeSafe の API キー（https://typesafe.ai）
- Expo アカウント（Free プラン）
- Apple Developer Program（iPhone に配布する場合）
- Firebase プロジェクト（Android にプッシュ通知を送る場合・無料）

## セットアップ

### 1. 依存関係

```bash
bun install
```

### 2. Supabase

1. [Supabase](https://supabase.com/dashboard) でプロジェクトを作成します（リージョンは Tokyo 推奨）。
2. Authentication → Sign In / Providers → Email で「Confirm email」をオフにします（家族利用のため。無料枠のメール送信数も節約できます）。
3. マイグレーションを適用します。スキーマ・RLS・初期品目マスタ（304件）・ストレージ・定期実行が入ります。

   ```bash
   bunx supabase login
   bunx supabase link --project-ref <project-ref>
   bunx supabase db push
   ```

4. SQL Editor で、定期実行が Edge Function を呼ぶための値を Vault に登録します。`<CRON_SECRET>` は長いランダム文字列にします（例: `openssl rand -hex 32`）。

   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
   ```

5. Edge Functions のシークレットを設定してデプロイします。

   ```bash
   bunx supabase secrets set OPENAI_API_KEY=<OpenAI の API キー> TYPESAFE_API_KEY=<TypeSafe の API キー> CRON_SECRET=<CRON_SECRET>
   bunx supabase functions deploy analyze-purchase
   bunx supabase functions deploy expiry-alerts
   ```

### 3. アプリ

```bash
cd apps/mobile
cp .env.example .env          # Supabase の URL と anon（publishable）キーを記入
bunx eas-cli login
bunx eas-cli init             # app.json に EAS の projectId が入る（プッシュ通知に必要）
```

EAS のビルドには `.env` がアップロードされないので、同じ値を EAS の環境変数にも登録します。

```bash
bunx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_URL --value https://<project-ref>.supabase.co --environment development --environment preview --environment production --visibility plaintext
bunx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --environment development --environment preview --environment production --visibility plaintext
```

#### 開発

カメラとプッシュ通知を使うため、開発ビルドを端末に入れて開発します（EAS Build は無料プランで iOS・Android 各月15回まで）。

```bash
bunx eas-cli build --profile development --platform android   # または ios
bunx expo start
```

#### 家族への配布

- **iPhone**: `bunx eas-cli build --profile production --platform ios` → `bunx eas-cli submit --platform ios` で TestFlight にアップロードし、App Store Connect で家族を内部テスターに追加します。初回ビルド時に EAS がプッシュ通知用のキーの作成を案内します。
- **Android**: `bunx eas-cli build --profile preview --platform android` で APK を作り、表示されるリンクから家族の端末にインストールします。
- **Android のプッシュ通知**: Firebase でプロジェクトと Android アプリ（パッケージ名 `com.nkuro3.fridge`）を作成し、`google-services.json` を `apps/mobile/` に置いて `app.json` の `expo.android.googleServicesFile` に `"./google-services.json"` を設定します。あわせて FCM V1 のサービスアカウントキーを `bunx eas-cli credentials` で登録します。

## 使い方の流れ

1. アカウントを作成し、世帯を作る（2人目以降は設定画面の招待コードで参加）
2. 買い物から帰ったら「まとめて登録」でレシートと食品を撮影 → AI の判定結果を確認して登録
3. 使い切ったら／捨てたら記録（その品目の最後の1つなら、買い物リストへの追加が初期オン）
4. 毎朝（時刻は設定で変更可）期限3日以内と解凍済みの食品が通知される

## 開発コマンド

```bash
bun run typecheck
bun run lint
bun run test                                                        # 純粋関数のテスト
PGURL=postgres://postgres@localhost:5432/postgres bun run test:db   # マイグレーションのテスト（ローカルの Postgres 16+）
```

## 無料枠での注意

| サービス | 制限 | このアプリでの扱い |
| --- | --- | --- |
| Supabase Free | DB 500MB・Storage 1GB。1週間アクセスがないとプロジェクトが一時停止 | 画像は長辺1280pxの JPEG に圧縮、レシート画像は登録後に削除。停止したらダッシュボードから再開する |
| OpenAI（gpt-6-luna） | 無料枠なし。入力 $0.10・出力 $0.50／100万トークン | まとめ登録1回＝1リクエスト。ダッシュボードで月の使用上限を設定しておく。上限に達したら手入力に切り替える |
| TypeSafe（Jev） | 入力 $0.042／100万トークン、出力は無料。日本語は英語より精度が低い | 商品1点につき1リクエスト。判定に失敗したら一般名の一致か新しい品目の提案で代用する |
| Expo Free | EAS Build は月15回（iOS・Android それぞれ） | 開発ビルドを使い回し、配布用ビルドは必要なときだけ作る |

## 構成

```
apps/mobile          Expo アプリ（src/app が画面、src/lib がデータ取得、src/components が部品）
packages/shared      型・表示ロジック・登録ペイロード生成
supabase/migrations  スキーマ・RLS・RPC・トリガー・初期品目マスタ
supabase/functions   analyze-purchase（AI 判定）、expiry-alerts（使い切りアラート）
supabase/tests       マイグレーションのテスト
supabase/data        初期品目マスタの元データ（CSV）
```
