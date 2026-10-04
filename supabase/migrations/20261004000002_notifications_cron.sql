-- 30日より前のお知らせを毎日消す（日本時間 4:10）
select cron.schedule('purge-old-notifications', '10 19 * * *', $$ select public.purge_old_notifications() $$);
