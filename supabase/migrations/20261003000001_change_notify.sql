-- 冷蔵庫の更新通知: 家族が登録・使い切り・廃棄・冷凍／解凍・残量変更をしたら、ほかのメンバーに知らせる
-- product_events を「どこまで通知したか」のカーソルで読み進め、1分ごとにまとめて送る（定期実行は次のマイグレーション）

-- 更新通知を受け取るか（ユーザーごと）
alter table public.profiles add column notify_changes boolean not null default true;

-- どのイベントまで通知したか（1行だけ）。導入時点より前のイベントは通知しない
create table public.change_notify_cursor (
  id            smallint primary key default 1 check (id = 1),
  last_event_id bigint not null
);
insert into public.change_notify_cursor (id, last_event_id)
select 1, coalesce(max(id), 0) from public.product_events;

alter table public.change_notify_cursor enable row level security; -- ポリシーなし＝クライアントからは見えない
revoke all on public.change_notify_cursor from anon, authenticated;

-- 未通知のイベントがあるか（定期実行が Edge Function を呼ぶかどうかの判定に使う）
create function public.has_pending_change_events()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.product_events e
    where e.id > (select last_event_id from public.change_notify_cursor where id = 1)
      and e.created_at <= now() - interval '20 seconds' -- claim_change_events の既定の待ち時間と揃える
  )
$$;

-- 未通知のイベントを取り出してカーソルを進める（Edge Function から service_role で呼ぶ）
-- p_settle: 直近の操作は少し待ってからまとめる（続けて操作しているときに通知が細切れにならないように）
create function public.claim_change_events(p_settle interval default interval '20 seconds')
returns table (
  event_id     bigint,
  household_id uuid,
  actor_id     uuid,
  actor_name   text,
  type         public.product_event_type,
  from_value   text,
  to_value     text,
  item_name    text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from bigint;
  v_to   bigint;
begin
  select c.last_event_id into v_from from public.change_notify_cursor c where c.id = 1 for update;

  select max(e.id) into v_to
  from public.product_events e
  where e.id > v_from and e.created_at <= now() - p_settle;
  if v_to is null then
    return;
  end if;

  update public.change_notify_cursor set last_event_id = v_to where id = 1;

  return query
  select e.id, e.household_id, e.created_by, coalesce(nullif(pr.display_name, ''), '家族'),
         e.type, e.from_value, e.to_value, m.name
  from public.product_events e
  join public.products p on p.id = e.product_id
  join public.item_masters m on m.id = p.item_master_id
  left join public.profiles pr on pr.user_id = e.created_by
  where e.id > v_from and e.id <= v_to
  order by e.id;
end;
$$;

revoke execute on function public.has_pending_change_events() from anon, authenticated, public;
revoke execute on function public.claim_change_events(interval) from anon, authenticated, public;
grant execute on function public.has_pending_change_events() to service_role;
grant execute on function public.claim_change_events(interval) to service_role;
