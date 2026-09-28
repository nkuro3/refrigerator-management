// DB の行型と、アプリ・Edge Function 間で受け渡す型
// DB 定義は supabase/migrations/20260928000001_core.sql、
// AI 判定の結果型は supabase/functions/analyze-purchase/normalize.ts と揃えること

export type RemainingLevel = "unopened" | "few_left" | "almost_empty";
export type FreezeState = "none" | "frozen" | "thawed";
export type EndReason = "used_up" | "discarded";
export type DiscardReason = "expired" | "spoiled" | "other";

export type Category = { id: number; name: string; sort_order: number };

export type ItemMaster = {
  id: string;
  household_id: string | null;
  category_id: number;
  name: string;
  aliases: string[];
  shelf_days: number;
  frozen_shelf_days: number | null;
};

export type Product = {
  id: string;
  household_id: string;
  purchase_id: string | null;
  item_master_id: string;
  name: string;
  image_path: string | null;
  price: number | null;
  purchased_on: string; // YYYY-MM-DD
  remaining: RemainingLevel;
  freeze_state: FreezeState;
  freeze_changed_on: string | null;
  expires_on: string | null;
  expires_is_estimated: boolean;
  ended_at: string | null;
  end_reason: EndReason | null;
  discard_reason: DiscardReason | null;
  created_at: string;
};

// 一覧表示用: 品目名とカテゴリを付けた商品
export type ProductWithItem = Product & {
  item_masters: Pick<ItemMaster, "name" | "category_id">;
};

export type ShoppingListItem = {
  id: string;
  item_master_id: string;
  note: string | null;
  is_purchased: boolean;
  purchased_at: string | null;
  created_at: string;
  item_masters: Pick<ItemMaster, "name" | "category_id">;
};

export type DashboardSummary = {
  used_up_count: number;
  discarded_count: number;
  discarded_amount: number;
  expired_count: number;
  spoiled_count: number;
  other_count: number;
  used_up_rate: number | null;
};

// ---- AI 判定（analyze-purchase） ----
export type NewItemProposal = {
  name: string;
  categoryId: number;
  shelfDays: number;
  frozenShelfDays: number | null;
};

export type Candidate = {
  key: string;
  name: string;
  receiptText: string | null;
  quantity: number;
  unitPrice: number | null;
  isFrozen: boolean;
  source: "both" | "receipt_only" | "photo_only";
  confidence: "high" | "medium" | "low";
  itemMasterId: string | null;
  newItem: NewItemProposal | null;
};

export type AnalysisResult = {
  purchasedOn: string | null;
  items: Candidate[];
  model?: string;
};
