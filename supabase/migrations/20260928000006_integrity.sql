-- 整合性の補強
-- 外部キーは RLS を通らないため、他の世帯の品目・商品・購入を参照できないようトリガーで検査する

create function public.assert_same_household_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.item_masters m
     where m.id = new.item_master_id
       and (m.household_id is null or m.household_id = new.household_id)
  ) then
    raise exception 'item_master % is not available in this household', new.item_master_id;
  end if;

  -- plpgsql は and を短絡評価しないので、テーブルごとに if を分ける
  if tg_table_name = 'products' then
    if new.purchase_id is not null and not exists (
      select 1 from public.purchases p where p.id = new.purchase_id and p.household_id = new.household_id
    ) then
      raise exception 'purchase % belongs to another household', new.purchase_id;
    end if;
  elsif tg_table_name = 'shopping_list_items' then
    if new.added_from_product_id is not null and not exists (
      select 1 from public.products p where p.id = new.added_from_product_id and p.household_id = new.household_id
    ) then
      raise exception 'product % belongs to another household', new.added_from_product_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger products_assert_refs
  before insert or update of item_master_id, purchase_id, household_id on public.products
  for each row execute function public.assert_same_household_refs();

create trigger shopping_assert_refs
  before insert or update of item_master_id, added_from_product_id, household_id on public.shopping_list_items
  for each row execute function public.assert_same_household_refs();

-- 買い物リストの「購入済み」を戻す。同じ品目が未購入で残っていれば、重複させずにそちらへまとめる
create function public.unpurchase_shopping_item(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item public.shopping_list_items;
begin
  select * into v_item from public.shopping_list_items where id = p_id;
  if v_item.id is null then
    raise exception 'shopping item not found';
  end if;
  if exists (
    select 1 from public.shopping_list_items
     where household_id = v_item.household_id and item_master_id = v_item.item_master_id
       and not is_purchased and id <> p_id
  ) then
    delete from public.shopping_list_items where id = p_id;
  else
    update public.shopping_list_items set is_purchased = false, purchased_at = null where id = p_id;
  end if;
end;
$$;

-- プッシュトークンの登録。端末を別のユーザーが使い始めた場合は持ち主を付け替える
create function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

revoke execute on function public.unpurchase_shopping_item(uuid) from anon, public;
revoke execute on function public.register_push_token(text, text) from anon, public;
grant execute on function public.unpurchase_shopping_item(uuid) to authenticated, service_role;
grant execute on function public.register_push_token(text, text) to authenticated, service_role;
