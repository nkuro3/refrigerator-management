-- マイグレーションの動作テスト（ローカル Postgres で実行: supabase/tests/run.sh）
-- 失敗すると例外で止まる
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'c@example.com');

create function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'ASSERT FAILED: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

select pg_temp.assert((select count(*) from public.profiles) = 3, 'サインアップでプロフィールが作られる');
select pg_temp.assert((select count(*) from public.item_masters where household_id is null) = 304, '初期品目は304件');

-- ---- 世帯の作成・招待・参加 ----
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.create_household('黒田家') as hid \gset
select public.create_invite() as code \gset

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.join_household(:'code');
select pg_temp.assert(public.my_household_id() = :'hid', '招待コードで同じ世帯に参加できる');
select pg_temp.assert((select count(*) from public.household_members) = 2, 'メンバー2人が見える');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select public.create_household('別の家');

-- ---- まとめ登録 ----
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select id as vinegar from public.item_masters where name = '酢' and household_id is null \gset
select id as udon from public.item_masters where name = 'うどん' and household_id is null \gset
select id as beef from public.item_masters where name = '牛肉' and household_id is null \gset

select public.register_purchase(jsonb_build_object(
  'purchased_on', '2026-09-20',
  'receipt_image_path', :'hid' || '/r.jpg',
  'item_photo_paths', jsonb_build_array(:'hid' || '/p1.jpg'),
  'new_items', jsonb_build_array(jsonb_build_object(
    'key', 'n1', 'name', 'ぬか漬けの素', 'category_id', 8, 'shelf_days', 90, 'frozen_shelf_days', null, 'aliases', jsonb_build_array())),
  'items', jsonb_build_array(
    jsonb_build_object('item_master_id', :'vinegar', 'name', 'ミツカン穀物酢', 'unit_price', 198, 'quantity', 2, 'is_frozen', false),
    jsonb_build_object('item_master_id', :'udon', 'name', '冷凍さぬきうどん', 'unit_price', 298, 'quantity', 1, 'is_frozen', true),
    jsonb_build_object('item_master_id', :'beef', 'name', '国産牛こま', 'unit_price', 598, 'quantity', 1, 'is_frozen', false),
    jsonb_build_object('new_item_key', 'n1', 'name', 'ぬか漬けの素 400g', 'unit_price', 450, 'quantity', 1, 'is_frozen', false)
  )
)) as purchase \gset

select pg_temp.assert((select count(*) from public.products) = 5, '数量2は2行に分かれて計5行');
select pg_temp.assert((select count(*) from public.item_masters where household_id = :'hid') = 1, '承認した新しい品目が世帯に追加される');
select pg_temp.assert((select expires_on from public.products where name = '国産牛こま') = date '2026-09-23', '牛肉: 購入日+3日');
select pg_temp.assert((select expires_on from public.products where name = '冷凍さぬきうどん') = date '2026-09-20' + 60, '冷凍うどん: 購入日+冷凍60日');
select pg_temp.assert((select freeze_state from public.products where name = '冷凍さぬきうどん') = 'frozen', 'AIが冷凍と判断したものは冷凍中で登録');
select pg_temp.assert((select count(*) from public.product_events where type = 'created') = 5, '登録イベントが記録される');

-- ---- 冷凍・解凍 ----
update public.products set freeze_state = 'frozen' where name = '国産牛こま';
select pg_temp.assert((select expires_on from public.products where name = '国産牛こま') = public.today_jst() + 30, '冷凍すると冷凍した日+30日');
update public.products set freeze_state = 'thawed' where name = '国産牛こま';
select pg_temp.assert((select expires_on from public.products where name = '国産牛こま') is null, '解凍済みは期限なし');
select pg_temp.assert(exists (select 1 from public.expiring_products where name = '国産牛こま' and is_thawed), '解凍済みは期限間近の一覧に載る');

-- ---- 手動での期限修正 ----
update public.products set expires_on = public.today_jst() + 2, expires_is_estimated = false
 where id = (select id from public.products where name = 'ミツカン穀物酢' limit 1);
select pg_temp.assert((select count(*) from public.expiring_products where name = 'ミツカン穀物酢') = 1, '期限3日以内は一覧に載る');
select pg_temp.assert(exists (select 1 from public.product_events where type = 'expiry_edited'), '期限の手動修正が記録される');

-- ---- 終了と買い物リスト ----
update public.products set remaining = 'almost_empty', ended_at = now(), end_reason = 'used_up'
 where id = (select id from public.products where name = 'ミツカン穀物酢' and expires_is_estimated limit 1);
select public.add_to_shopping_list(:'vinegar', 'ミツカン穀物酢', null);
select public.add_to_shopping_list(:'vinegar', null, null);
select pg_temp.assert((select count(*) from public.shopping_list_items where not is_purchased) = 1, '同じ品目は買い物リストで重複しない');
select pg_temp.assert((select note from public.shopping_list_items) = 'ミツカン穀物酢', 'メモは上書きで消えない');

update public.products set ended_at = now(), end_reason = 'discarded', discard_reason = 'expired' where name = '国産牛こま';

select public.register_purchase(jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('item_master_id', :'vinegar', 'name', 'タマノイ米酢', 'unit_price', 258, 'quantity', 1, 'is_frozen', false))));
select pg_temp.assert((select is_purchased from public.shopping_list_items) is true, '登録すると買い物リストの品目が購入済みになる');

select * from public.dashboard_summary(public.today_jst() - 30, public.today_jst()) \gset d_
select pg_temp.assert(:d_used_up_count = 1 and :d_discarded_count = 1 and :d_discarded_amount = 598 and :d_expired_count = 1, 'ダッシュボード: 使い切り1・廃棄1（598円・期限切れ）');
select pg_temp.assert(:d_used_up_rate = 0.5, '使い切り率 50%');

-- 終了の取り消し
update public.products set ended_at = null, end_reason = null, discard_reason = null where name = '国産牛こま';
select pg_temp.assert(exists (select 1 from public.product_events where type = 'end_undone'), '終了の取り消しが記録される');

-- ---- RLS: 別の世帯からは見えない・書けない ----
select set_config('test.hid', :'hid', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.assert((select count(*) from public.products) = 0, '別世帯の商品は見えない');
select pg_temp.assert((select count(*) from public.item_masters where household_id is not null) = 0, '別世帯の追加品目は見えない');
select pg_temp.assert((select count(*) from public.item_masters) = 304, '共通品目は見える');
do $$
begin
  insert into public.products (household_id, item_master_id, name)
  values (current_setting('test.hid')::uuid, (select id from public.item_masters limit 1), 'x');
  raise exception 'ASSERT FAILED: 別世帯に書き込めてしまった';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'ok: 所属していない世帯には書き込めない (%)', sqlerrm;
end $$;
do $$
begin
  perform public.join_household('XXXXXXXX');
  raise exception 'ASSERT FAILED: 2つ目の世帯に参加できてしまった';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'ok: 1ユーザーは1世帯のみ (%)', sqlerrm;
end $$;

-- 未ログインは何もできない
reset role;
set role anon;
do $$
begin
  perform count(*) from public.products;
  raise exception 'ASSERT FAILED: anon が読めてしまった';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'ok: anon は読めない';
end $$;
reset role;


-- ---- 整合性（20260928000006_integrity.sql） ----
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
insert into public.item_masters (household_id, category_id, name, shelf_days)
values (public.my_household_id(), 13, 'C家の品目', 7) returning id as c_item \gset
select set_config('test.c_item', :'c_item', false);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
begin
  perform public.add_to_shopping_list(current_setting('test.c_item')::uuid);
  raise exception 'ASSERT FAILED: 他世帯の品目を買い物リストに入れられた';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'ok: 他世帯の品目は参照できない (%)', sqlerrm;
end $$;
do $$
begin
  perform public.register_purchase(jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('item_master_id', current_setting('test.c_item'), 'name', 'x', 'quantity', 1))));
  raise exception 'ASSERT FAILED: 他世帯の品目で登録できた';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'ok: 他世帯の品目では登録できない (%)', sqlerrm;
end $$;

-- 購入済みを戻すとき、未購入の同じ品目があればまとめる
select public.add_to_shopping_list(:'vinegar', null, null);
select id as bought from public.shopping_list_items where item_master_id = :'vinegar' and is_purchased \gset
select public.unpurchase_shopping_item(:'bought');
select pg_temp.assert((select count(*) from public.shopping_list_items where item_master_id = :'vinegar') = 1, '購入済みを戻すと未購入の行にまとまる');
select public.unpurchase_shopping_item((select id from public.shopping_list_items where item_master_id = :'vinegar'));
select pg_temp.assert((select count(*) from public.shopping_list_items where item_master_id = :'vinegar' and not is_purchased) = 1, '未購入のままなら何も変わらない');

-- プッシュトークンの持ち主の付け替え
select public.register_push_token('ExponentPushToken[test]', 'ios');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.register_push_token('ExponentPushToken[test]', 'android');
select pg_temp.assert((select user_id from public.push_tokens where token = 'ExponentPushToken[test]') = '00000000-0000-0000-0000-00000000000b', '同じ端末で別のユーザーがログインすると持ち主が変わる');
reset role;


-- ---- Web Push の購読（20260930000001_web_push.sql） ----
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.register_web_push('https://web.push.apple.com/abc', 'p256dh-a', 'auth-a');
select pg_temp.assert((select count(*) from public.web_push_subscriptions) = 1, 'Web Push の購読を登録できる');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.assert((select count(*) from public.web_push_subscriptions) = 0, '他人の購読は見えない');
select public.register_web_push('https://web.push.apple.com/abc', 'p256dh-b', 'auth-b');
select pg_temp.assert((select count(*) from public.web_push_subscriptions) = 1, '同じブラウザで別のユーザーが登録すると持ち主が変わる');
do $$
begin
  perform public.register_web_push('http://evil.example/x', 'k', 'a');
  raise exception 'ASSERT FAILED: https 以外の endpoint を登録できた';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'ok: https 以外の endpoint は拒否 (%)', sqlerrm;
end $$;
reset role;

\echo 'ALL TESTS PASSED'
