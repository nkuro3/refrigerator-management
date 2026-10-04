-- お知らせ: プッシュ通知と同じ内容をアプリ内（ヘッダーのベル）でも見られるように保存する
-- Edge Functions（expiry-alerts・change-notify）が service_role で書き込み、本人だけが読める
create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('expiry', 'change')), -- 使い切りアラート・冷蔵庫の更新
  title      text not null,
  body       text not null,
  url        text not null default '/',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.notifications from anon;
revoke insert, update, delete on public.notifications from authenticated;

-- 自分のお知らせをすべて既読にする
create function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null
$$;
revoke execute on function public.mark_notifications_read() from anon, public;
grant execute on function public.mark_notifications_read() to authenticated;

-- 古いお知らせを消す（30日より前）。定期実行から呼ぶ
create function public.purge_old_notifications()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.notifications where created_at < now() - interval '30 days'
$$;
revoke execute on function public.purge_old_notifications() from anon, authenticated, public;

-- 届いたらベルの未読数をすぐ更新する
alter publication supabase_realtime add table public.notifications;
