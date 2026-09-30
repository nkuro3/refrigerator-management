-- Web 版（PWA）のプッシュ通知の購読情報
-- ブラウザの PushSubscription（endpoint と鍵）を端末ごとに保存する
create table public.web_push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  updated_at timestamptz not null default now()
);
create index web_push_subscriptions_user_id_idx on public.web_push_subscriptions (user_id);

alter table public.web_push_subscriptions enable row level security;

create policy web_push_select on public.web_push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy web_push_delete on public.web_push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- 購読の登録。同じブラウザを別のユーザーが使い始めた場合は持ち主を付け替える
create function public.register_web_push(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_endpoint !~ '^https://' then
    raise exception 'invalid endpoint';
  end if;
  insert into public.web_push_subscriptions (endpoint, user_id, p256dh, auth, updated_at)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, now())
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, updated_at = now();
end;
$$;

revoke all on public.web_push_subscriptions from anon;
revoke execute on function public.register_web_push(text, text, text) from anon, public;
grant execute on function public.register_web_push(text, text, text) to authenticated, service_role;
