-- =========================================================
-- 冷蔵庫管理アプリ: コアスキーマ
-- 世帯単位でデータを共有し、RLSで世帯ごとに分離する
-- =========================================================

-- ---------- 型 ----------
create type public.member_role as enum ('owner', 'member');
create type public.remaining_level as enum ('unopened', 'few_left', 'almost_empty');
create type public.freeze_state as enum ('none', 'frozen', 'thawed');
create type public.end_reason as enum ('used_up', 'discarded');
create type public.discard_reason as enum ('expired', 'spoiled', 'other');
create type public.product_event_type as enum (
  'created', 'remaining_changed', 'freeze_changed', 'expiry_edited', 'ended', 'end_undone'
);

-- ---------- 共通関数 ----------
-- 日本時間の「今日」
create function public.today_jst()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Tokyo')::date
$$;

-- ---------- ユーザー・世帯 ----------
create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  notify_hour  smallint not null default 8 check (notify_hour between 0 and 23), -- 使い切りアラートの通知時刻（日本時間）
  created_at   timestamptz not null default now()
);

create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 50),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         public.member_role not null default 'member',
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id) -- 1ユーザーは1世帯のみ
);

create table public.household_invites (
  code         text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  created_by   uuid references auth.users (id) on delete set null,
  expires_at   timestamptz not null default now() + interval '7 days',
  created_at   timestamptz not null default now()
);

create table public.push_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);
create index push_tokens_user_id_idx on public.push_tokens (user_id);

-- 自分が所属する世帯ID（RLSから使う）
create function public.my_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select household_id from public.household_members where user_id = auth.uid()
$$;

-- サインアップ時にプロフィールを作成
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, ''), '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 品目マスタ ----------
create table public.categories (
  id         smallint primary key,
  name       text not null unique,
  sort_order smallint not null
);

create table public.item_masters (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid references public.households (id) on delete cascade, -- null = 全世帯共通
  category_id       smallint not null references public.categories (id),
  name              text not null check (char_length(name) between 1 and 40),
  aliases           text[] not null default '{}',
  shelf_days        integer not null check (shelf_days > 0),
  frozen_shelf_days integer check (frozen_shelf_days > 0), -- null = 冷凍に向かない（冷凍時は30日で推定）
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now()
);
-- 共通品目・世帯品目それぞれで名前を一意にする
create unique index item_masters_household_name_key
  on public.item_masters (household_id, name) nulls not distinct;
create index item_masters_category_idx on public.item_masters (category_id);

-- ---------- 購入・商品 ----------
create table public.purchases (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households (id) on delete cascade,
  purchased_on       date not null default public.today_jst(),
  receipt_image_path text,               -- 登録確定後に削除し null にする
  item_photo_paths   text[] not null default '{}',
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index purchases_household_idx on public.purchases (household_id, purchased_on desc);

create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households (id) on delete cascade,
  purchase_id          uuid references public.purchases (id) on delete set null,
  item_master_id       uuid not null references public.item_masters (id),
  name                 text not null check (char_length(name) between 1 and 80),
  image_path           text,
  price                integer check (price >= 0), -- 1本あたりの価格（円）
  purchased_on         date not null default public.today_jst(),
  remaining            public.remaining_level not null default 'unopened',
  freeze_state         public.freeze_state not null default 'none',
  freeze_changed_on    date,
  expires_on           date,             -- 解凍済みのときは null
  expires_is_estimated boolean not null default true,
  ended_at             timestamptz,
  end_reason           public.end_reason,
  discard_reason       public.discard_reason,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint products_end_consistency check (
    (ended_at is null and end_reason is null and discard_reason is null)
    or (ended_at is not null and end_reason = 'used_up' and discard_reason is null)
    or (ended_at is not null and end_reason = 'discarded')
  )
);
create index products_active_idx on public.products (household_id, expires_on) where ended_at is null;
create index products_ended_idx on public.products (household_id, ended_at) where ended_at is not null;
create index products_item_idx on public.products (item_master_id);

create table public.product_events (
  id         bigint generated always as identity primary key,
  product_id uuid not null references public.products (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  type       public.product_event_type not null,
  from_value text,
  to_value   text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index product_events_product_idx on public.product_events (product_id, created_at);

-- ---------- 買い物リスト ----------
create table public.shopping_list_items (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households (id) on delete cascade,
  item_master_id        uuid not null references public.item_masters (id),
  note                  text check (char_length(note) <= 80), -- 商品名のメモ（任意）
  is_purchased          boolean not null default false,
  purchased_at          timestamptz,
  added_from_product_id uuid references public.products (id) on delete set null,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now()
);
-- 未購入の同じ品目は1件だけ
create unique index shopping_list_open_item_key
  on public.shopping_list_items (household_id, item_master_id) where not is_purchased;

-- =========================================================
-- 期限の推定
-- =========================================================
create function public.estimate_expiry(
  p_item_master_id uuid,
  p_purchased_on date,
  p_freeze_state public.freeze_state,
  p_freeze_changed_on date
)
returns date
language sql
stable
set search_path = ''
as $$
  select case p_freeze_state
    when 'none'   then p_purchased_on + m.shelf_days
    when 'frozen' then coalesce(p_freeze_changed_on, p_purchased_on) + coalesce(m.frozen_shelf_days, 30)
    else null -- 解凍済みは期限を推定しない
  end
  from public.item_masters m
  where m.id = p_item_master_id
$$;

create function public.products_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.freeze_state <> 'none' and new.freeze_changed_on is null then
      new.freeze_changed_on := new.purchased_on;
    end if;
    if new.expires_on is null then
      new.expires_on := public.estimate_expiry(new.item_master_id, new.purchased_on, new.freeze_state, new.freeze_changed_on);
      new.expires_is_estimated := true;
    end if;
  else
    new.updated_at := now();
    if new.household_id <> old.household_id then
      raise exception 'household_id cannot be changed';
    end if;
    -- 冷凍状態が変わったら、その日を起点に期限を推定し直す
    if new.freeze_state is distinct from old.freeze_state then
      new.freeze_changed_on := public.today_jst();
      new.expires_on := public.estimate_expiry(new.item_master_id, new.purchased_on, new.freeze_state, new.freeze_changed_on);
      new.expires_is_estimated := true;
    -- 品目が変わったら（推定値のときだけ）推定し直す
    elsif new.item_master_id <> old.item_master_id and new.expires_is_estimated then
      new.expires_on := public.estimate_expiry(new.item_master_id, new.purchased_on, new.freeze_state, new.freeze_changed_on);
    end if;
  end if;
  return new;
end;
$$;

create trigger products_before_write
  before insert or update on public.products
  for each row execute function public.products_before_write();

-- 状態変化をイベントとして記録（ダッシュボードの集計用）
create function public.products_log_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.product_events (product_id, household_id, type, to_value, created_by)
    values (new.id, new.household_id, 'created', new.remaining::text, v_actor);
    return new;
  end if;

  if new.remaining is distinct from old.remaining then
    insert into public.product_events (product_id, household_id, type, from_value, to_value, created_by)
    values (new.id, new.household_id, 'remaining_changed', old.remaining::text, new.remaining::text, v_actor);
  end if;

  if new.freeze_state is distinct from old.freeze_state then
    insert into public.product_events (product_id, household_id, type, from_value, to_value, created_by)
    values (new.id, new.household_id, 'freeze_changed', old.freeze_state::text, new.freeze_state::text, v_actor);
  elsif new.expires_on is distinct from old.expires_on and not new.expires_is_estimated then
    insert into public.product_events (product_id, household_id, type, from_value, to_value, created_by)
    values (new.id, new.household_id, 'expiry_edited', old.expires_on::text, new.expires_on::text, v_actor);
  end if;

  if old.ended_at is null and new.ended_at is not null then
    insert into public.product_events (product_id, household_id, type, from_value, to_value, created_by)
    values (new.id, new.household_id, 'ended', new.remaining::text,
            new.end_reason::text || coalesce(':' || new.discard_reason::text, ''), v_actor);
  elsif old.ended_at is not null and new.ended_at is null then
    insert into public.product_events (product_id, household_id, type, from_value, created_by)
    values (new.id, new.household_id, 'end_undone', old.end_reason::text, v_actor);
  end if;

  return new;
end;
$$;

create trigger products_log_events
  after insert or update on public.products
  for each row execute function public.products_log_events();

-- 登録された品目が買い物リストにあれば購入済みにする
create function public.products_mark_shopping_purchased()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.shopping_list_items
     set is_purchased = true, purchased_at = now()
   where household_id = new.household_id
     and item_master_id = new.item_master_id
     and not is_purchased;
  return new;
end;
$$;

create trigger products_mark_shopping_purchased
  after insert on public.products
  for each row execute function public.products_mark_shopping_purchased();

-- =========================================================
-- RPC
-- =========================================================

-- 世帯を作成して owner になる
create function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'already in a household';
  end if;
  insert into public.households (name) values (p_name) returning id into v_id;
  insert into public.household_members (household_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return v_id;
end;
$$;

-- 招待コードを発行（7日間有効）
create function public.create_invite()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid := public.my_household_id();
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 紛らわしい文字を除く
  v_code text;
begin
  if v_household is null then
    raise exception 'not in a household';
  end if;
  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      into v_code
      from generate_series(1, 8);
    exit when not exists (select 1 from public.household_invites where code = v_code);
  end loop;
  insert into public.household_invites (code, household_id, created_by) values (v_code, v_household, auth.uid());
  return v_code;
end;
$$;

-- 招待コードで世帯に参加
create function public.join_household(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'already in a household';
  end if;
  select household_id into v_household
    from public.household_invites
   where code = upper(trim(p_code)) and expires_at > now();
  if v_household is null then
    raise exception 'invalid or expired invite code';
  end if;
  insert into public.household_members (household_id, user_id, role) values (v_household, auth.uid(), 'member');
  return v_household;
end;
$$;

-- まとめ登録: 購入・新しい品目・商品を1トランザクションで作成する
-- p_payload:
-- {
--   "purchased_on": "2026-09-28",
--   "receipt_image_path": "…" | null,
--   "item_photo_paths": ["…"],
--   "image_path": "…" | null,               -- 商品に紐づけるまとめ写真
--   "new_items": [{"key": "n1", "name": "…", "category_id": 3, "shelf_days": 5, "frozen_shelf_days": 30, "aliases": []}],
--   "items": [{"item_master_id": "uuid" | null, "new_item_key": "n1" | null,
--              "name": "…", "unit_price": 198 | null, "quantity": 2, "is_frozen": false}]
-- }
create function public.register_purchase(p_payload jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid := public.my_household_id();
  v_purchase uuid;
  v_purchased_on date := coalesce((p_payload ->> 'purchased_on')::date, public.today_jst());
  v_keys jsonb := '{}'::jsonb;
  v_new jsonb;
  v_item jsonb;
  v_master uuid;
  v_qty int;
begin
  if v_household is null then
    raise exception 'not in a household';
  end if;

  insert into public.purchases (household_id, purchased_on, receipt_image_path, item_photo_paths, created_by)
  values (
    v_household,
    v_purchased_on,
    p_payload ->> 'receipt_image_path',
    coalesce(array(select jsonb_array_elements_text(p_payload -> 'item_photo_paths')), '{}'),
    auth.uid()
  )
  returning id into v_purchase;

  -- 新しい品目（AIの提案をユーザーが承認したもの）
  for v_new in select * from jsonb_array_elements(coalesce(p_payload -> 'new_items', '[]'::jsonb)) loop
    insert into public.item_masters (household_id, category_id, name, aliases, shelf_days, frozen_shelf_days, created_by)
    values (
      v_household,
      (v_new ->> 'category_id')::smallint,
      trim(v_new ->> 'name'),
      coalesce(array(select jsonb_array_elements_text(v_new -> 'aliases')), '{}'),
      (v_new ->> 'shelf_days')::int,
      nullif(v_new ->> 'frozen_shelf_days', '')::int,
      auth.uid()
    )
    on conflict (household_id, name) do nothing
    returning id into v_master;

    if v_master is null then
      select id into v_master from public.item_masters
       where household_id = v_household and name = trim(v_new ->> 'name');
    end if;
    v_keys := v_keys || jsonb_build_object(v_new ->> 'key', v_master);
    v_master := null;
  end loop;

  -- 商品（数量分の行に分ける）
  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    v_master := coalesce((v_item ->> 'item_master_id')::uuid, (v_keys ->> (v_item ->> 'new_item_key'))::uuid);
    if v_master is null then
      raise exception 'item has no item_master_id: %', v_item ->> 'name';
    end if;
    v_qty := greatest(1, least(coalesce((v_item ->> 'quantity')::int, 1), 50));
    for i in 1..v_qty loop
      insert into public.products (household_id, purchase_id, item_master_id, name, image_path, price, purchased_on, freeze_state)
      values (
        v_household,
        v_purchase,
        v_master,
        trim(v_item ->> 'name'),
        p_payload ->> 'image_path',
        (v_item ->> 'unit_price')::int,
        v_purchased_on,
        case when coalesce((v_item ->> 'is_frozen')::boolean, false) then 'frozen' else 'none' end::public.freeze_state
      );
    end loop;
  end loop;

  return v_purchase;
end;
$$;

-- 買い物リストに追加（未購入の同じ品目があれば何もしない）
create function public.add_to_shopping_list(
  p_item_master_id uuid,
  p_note text default null,
  p_product_id uuid default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid := public.my_household_id();
begin
  if v_household is null then
    raise exception 'not in a household';
  end if;
  insert into public.shopping_list_items (household_id, item_master_id, note, added_from_product_id, created_by)
  values (v_household, p_item_master_id, nullif(trim(p_note), ''), p_product_id, auth.uid())
  on conflict (household_id, item_master_id) where not is_purchased
  do update set note = coalesce(excluded.note, public.shopping_list_items.note);
end;
$$;

-- =========================================================
-- ダッシュボード
-- =========================================================

-- 期限間近（3日以内）と解凍済みの在庫。解凍済みを先頭に表示する
create view public.expiring_products
with (security_invoker = true)
as
select
  p.*,
  m.name as item_name,
  m.category_id,
  (p.freeze_state = 'thawed') as is_thawed,
  (p.expires_on - public.today_jst()) as days_left
from public.products p
join public.item_masters m on m.id = p.item_master_id
where p.ended_at is null
  and (p.freeze_state = 'thawed' or p.expires_on <= public.today_jst() + 3);

-- 期間内に終了した商品の集計（期間は日本時間の日付で指定）
create function public.dashboard_summary(p_from date, p_to date)
returns table (
  used_up_count     bigint,
  discarded_count   bigint,
  discarded_amount  bigint,
  expired_count     bigint,
  spoiled_count     bigint,
  other_count       bigint,
  used_up_rate      numeric
)
language sql
stable
set search_path = ''
as $$
  with ended as (
    select *
      from public.products
     where household_id = public.my_household_id()
       and ended_at is not null
       and (ended_at at time zone 'Asia/Tokyo')::date between p_from and p_to
  )
  select
    count(*) filter (where end_reason = 'used_up'),
    count(*) filter (where end_reason = 'discarded'),
    coalesce(sum(price) filter (where end_reason = 'discarded'), 0),
    count(*) filter (where discard_reason = 'expired'),
    count(*) filter (where discard_reason = 'spoiled'),
    count(*) filter (where end_reason = 'discarded' and (discard_reason = 'other' or discard_reason is null)),
    case when count(*) = 0 then null
         else round(count(*) filter (where end_reason = 'used_up')::numeric / count(*), 3) end
  from ended
$$;

-- =========================================================
-- RLS
-- =========================================================
alter table public.profiles            enable row level security;
alter table public.households          enable row level security;
alter table public.household_members   enable row level security;
alter table public.household_invites   enable row level security;
alter table public.push_tokens         enable row level security;
alter table public.categories          enable row level security;
alter table public.item_masters        enable row level security;
alter table public.purchases           enable row level security;
alter table public.products            enable row level security;
alter table public.product_events      enable row level security;
alter table public.shopping_list_items enable row level security;

-- profiles: 自分と同じ世帯のメンバーを参照、自分だけ更新
create policy profiles_select on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or user_id in (select user_id from public.household_members where household_id = (select public.my_household_id()))
  );
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- households / members / invites: 所属世帯のみ参照（作成・参加はRPC経由）
create policy households_select on public.households for select to authenticated
  using (id = (select public.my_household_id()));
create policy households_update on public.households for update to authenticated
  using (id = (select public.my_household_id())) with check (id = (select public.my_household_id()));

create policy members_select on public.household_members for select to authenticated
  using (household_id = (select public.my_household_id()));

create policy invites_select on public.household_invites for select to authenticated
  using (household_id = (select public.my_household_id()));

-- push_tokens: 自分の端末のみ
create policy push_tokens_all on public.push_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- categories: 全員参照のみ
create policy categories_select on public.categories for select to authenticated using (true);

-- item_masters: 共通品目＋自分の世帯の品目を参照、世帯の品目のみ編集
create policy item_masters_select on public.item_masters for select to authenticated
  using (household_id is null or household_id = (select public.my_household_id()));
create policy item_masters_insert on public.item_masters for insert to authenticated
  with check (household_id = (select public.my_household_id()));
create policy item_masters_update on public.item_masters for update to authenticated
  using (household_id = (select public.my_household_id()))
  with check (household_id = (select public.my_household_id()));
create policy item_masters_delete on public.item_masters for delete to authenticated
  using (household_id = (select public.my_household_id()));

-- 世帯データ: 所属世帯のみ読み書き
create policy purchases_all on public.purchases for all to authenticated
  using (household_id = (select public.my_household_id()))
  with check (household_id = (select public.my_household_id()));
create policy products_all on public.products for all to authenticated
  using (household_id = (select public.my_household_id()))
  with check (household_id = (select public.my_household_id()));
create policy product_events_select on public.product_events for select to authenticated
  using (household_id = (select public.my_household_id()));
create policy shopping_all on public.shopping_list_items for all to authenticated
  using (household_id = (select public.my_household_id()))
  with check (household_id = (select public.my_household_id()));

-- anon には何も公開しない
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;
