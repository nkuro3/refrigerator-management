-- 冷蔵庫の更新通知: 毎分、未通知の変更があるときだけ Edge Function を呼ぶ
-- Vault の project_url・cron_secret は使い切りアラートと共通
select cron.schedule(
  'change-notify-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/change-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  )
  where public.has_pending_change_events()
    and exists (select 1 from vault.decrypted_secrets where name = 'project_url')
  $$
);
