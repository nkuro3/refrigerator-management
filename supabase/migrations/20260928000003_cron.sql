-- 使い切りアラート: 毎時0分に Edge Function を呼び、通知時刻が来たユーザーに送る
-- 事前に Vault へ次の2つを登録しておく（README 参照）
--   project_url : https://<project-ref>.supabase.co
--   cron_secret : Edge Function の CRON_SECRET と同じ値
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'expiry-alerts-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/expiry-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'project_url')
  $$
);
