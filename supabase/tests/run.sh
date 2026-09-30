#!/usr/bin/env bash
# ローカルの Postgres（16以上）でマイグレーションを検証する
# 使い方: PGURL=postgres://postgres@localhost:5432/postgres supabase/tests/run.sh
# ストレージと pg_cron は Supabase 固有なので対象外
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PGURL:?PGURL を指定してください}"
DB="fridge_test_$$"
psql "$PGURL" -qc "create database $DB"
trap 'psql "$PGURL" -qc "drop database if exists $DB"' EXIT
TEST_URL="${PGURL%/*}/$DB"
psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f tests/local_stub.sql
psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f migrations/20260928000001_core.sql
psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f migrations/20260928000004_item_master_seed.sql
psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f migrations/20260928000006_integrity.sql
psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f migrations/20260930000001_web_push.sql
psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f tests/core_test.sql
