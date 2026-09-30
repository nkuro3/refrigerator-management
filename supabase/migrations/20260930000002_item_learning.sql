-- 品目判定の精度を上げる
-- 1. 家族が確定した「商品名 → 品目」の対応を覚え、次回の AI 判定で最優先に使う
-- 2. 取り違えやすい品目の別名を足す（例: 料理酒が日本酒と判定された）

-- ---------- 商品名の正規化 ----------
-- 全角半角・大文字小文字・空白・記号・容量表記（500ml、2個 など）の違いを吸収する
create function public.normalize_product_name(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(
      lower(normalize(coalesce(p, ''), NFKC)),
      '[0-9]+(\.[0-9]+)?\s*(ml|l|g|kg|mg|cc|個|本|枚|袋|パック|入り|入|p|コ|切れ|尾|玉|株|束|缶|箱)', '', 'g'
    ),
    '[[:space:]・/()\[\]【】「」『』\-_.,、。×x*]+', '', 'g'
  )
$$;

-- ---------- 覚えた対応 ----------
create table public.item_name_mappings (
  household_id   uuid not null references public.households (id) on delete cascade,
  name_key       text not null,
  item_master_id uuid not null references public.item_masters (id) on delete cascade,
  updated_at     timestamptz not null default now(),
  primary key (household_id, name_key)
);

alter table public.item_name_mappings enable row level security;
create policy item_name_mappings_select on public.item_name_mappings for select to authenticated
  using (household_id = (select public.my_household_id()));
revoke all on public.item_name_mappings from anon;

-- 商品の登録・品目の変更のたびに、その商品名の品目として覚える（あとから直した品目で上書きされる）
create function public.products_learn_item_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := public.normalize_product_name(new.name);
begin
  if v_key = '' then
    return new;
  end if;
  insert into public.item_name_mappings (household_id, name_key, item_master_id, updated_at)
  values (new.household_id, v_key, new.item_master_id, now())
  on conflict (household_id, name_key)
  do update set item_master_id = excluded.item_master_id, updated_at = now();
  return new;
end;
$$;

create trigger products_learn_item_name
  after insert or update of item_master_id, name on public.products
  for each row execute function public.products_learn_item_name();

-- AI 判定から使う: 商品名の一覧に対して、覚えている品目を返す
create function public.lookup_item_mappings(p_names text[])
returns table (name text, item_master_id uuid)
language sql
stable
set search_path = ''
as $$
  select n, m.item_master_id
    from unnest(p_names) as n
    join public.item_name_mappings m
      on m.household_id = public.my_household_id()
     and m.name_key = public.normalize_product_name(n)
$$;

-- 既存の在庫からも覚えておく（直近の登録を優先）
insert into public.item_name_mappings (household_id, name_key, item_master_id, updated_at)
select distinct on (household_id, public.normalize_product_name(name))
       household_id, public.normalize_product_name(name), item_master_id, created_at
  from public.products
 where public.normalize_product_name(name) <> ''
 order by household_id, public.normalize_product_name(name), created_at desc
on conflict do nothing;

-- ---------- 取り違えやすい品目の別名 ----------
update public.item_masters
   set aliases = array(select distinct unnest(aliases || array['料理清酒', '料理用清酒', '料理用酒', '本料理酒', '清酒（料理用）', '酒（料理用）']))
 where household_id is null and name = '料理酒';
update public.item_masters
   set aliases = array(select distinct unnest(aliases || array['みりん風', '本味醂', '味醂']))
 where household_id is null and name = 'みりん';

revoke execute on function public.lookup_item_mappings(text[]) from anon, public;
grant execute on function public.lookup_item_mappings(text[]) to authenticated, service_role;
grant execute on function public.normalize_product_name(text) to authenticated, service_role;
