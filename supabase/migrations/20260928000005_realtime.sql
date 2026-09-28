-- 家族間の即時同期: 在庫と買い物リストの変更を Realtime で配信する（RLS に従って届く）
alter publication supabase_realtime add table public.products, public.shopping_list_items;
