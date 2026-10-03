#!/usr/bin/env bash
# まとめてデプロイ: DB のマイグレーション → Edge Functions → Web 版（Cloudflare Pages）
# 使い方（リポジトリ直下で）: bun run deploy
# 必要な値はリポジトリ直下の .env から読む（SUPABASE_ACCESS_TOKEN・SUPABASE_DB_PASSWORD・CLOUDFLARE_API_TOKEN・CLOUDFLARE_ACCOUNT_ID）
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo ".env がありません（README のセットアップを参照）" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a

for name in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do
  if [ -z "${!name:-}" ]; then
    echo ".env に $name がありません" >&2
    exit 1
  fi
done

echo "▶ 依存関係"
bun install

echo "▶ DB のマイグレーション"
bunx supabase db push

echo "▶ Edge Functions"
bunx supabase functions deploy analyze-purchase --use-api
bunx supabase functions deploy expiry-alerts --use-api
bunx supabase functions deploy change-notify --use-api

echo "▶ Web 版"
(cd apps/mobile && bun run deploy:web)

echo "✅ デプロイ完了"
