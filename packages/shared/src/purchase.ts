import type { Candidate, NewItemProposal } from "./types";

// 確認画面で編集する登録候補
export type DraftItem = {
  key: string;
  include: boolean;
  name: string;
  quantity: number;
  unitPrice: number | null;
  isFrozen: boolean;
  source: Candidate["source"];
  confidence: Candidate["confidence"];
  receiptText: string | null;
  // 既存の品目か、新しい品目の提案（どちらか一方）
  itemMasterId: string | null;
  newItem: NewItemProposal | null;
};

export function toDraftItems(candidates: Candidate[]): DraftItem[] {
  return candidates.map((c) => ({
    key: c.key,
    include: true,
    name: c.name,
    quantity: c.quantity,
    unitPrice: c.unitPrice,
    isFrozen: c.isFrozen,
    source: c.source,
    confidence: c.confidence,
    receiptText: c.receiptText,
    itemMasterId: c.itemMasterId,
    newItem: c.newItem,
  }));
}

// 目立たせるべき候補（自信が低い・片方にしかない・新しい品目）
export function needsReview(d: DraftItem): boolean {
  return d.confidence === "low" || d.source !== "both" || d.newItem !== null;
}

export type RegisterPayload = {
  purchased_on: string;
  receipt_image_path: string | null;
  item_photo_paths: string[];
  image_path: string | null;
  new_items: {
    key: string;
    name: string;
    category_id: number;
    shelf_days: number;
    frozen_shelf_days: number | null;
    aliases: string[];
  }[];
  items: {
    item_master_id: string | null;
    new_item_key: string | null;
    name: string;
    unit_price: number | null;
    quantity: number;
    is_frozen: boolean;
  }[];
};

export class DraftError extends Error {}

// register_purchase RPC に渡す形にする
// 同じ名前の新しい品目が複数の候補にある場合は1つにまとめる
export function buildRegisterPayload(
  drafts: DraftItem[],
  meta: { purchasedOn: string; receiptPath: string | null; photoPaths: string[] },
): RegisterPayload {
  const included = drafts.filter((d) => d.include);
  if (included.length === 0) throw new DraftError("登録する商品がありません");

  const newItemKeys = new Map<string, string>();
  const newItems: RegisterPayload["new_items"] = [];
  const items: RegisterPayload["items"] = [];

  for (const d of included) {
    const name = d.name.trim();
    if (!name) throw new DraftError("商品名が空の行があります");
    let newItemKey: string | null = null;
    if (!d.itemMasterId) {
      if (!d.newItem || !d.newItem.name.trim()) throw new DraftError(`「${name}」の品目を選んでください`);
      const itemName = d.newItem.name.trim();
      newItemKey = newItemKeys.get(itemName) ?? null;
      if (!newItemKey) {
        newItemKey = `n${newItems.length + 1}`;
        newItemKeys.set(itemName, newItemKey);
        newItems.push({
          key: newItemKey,
          name: itemName,
          category_id: d.newItem.categoryId,
          shelf_days: d.newItem.shelfDays,
          frozen_shelf_days: d.newItem.frozenShelfDays,
          aliases: [],
        });
      }
    }
    items.push({
      item_master_id: d.itemMasterId,
      new_item_key: newItemKey,
      name,
      unit_price: d.unitPrice,
      quantity: Math.min(50, Math.max(1, Math.round(d.quantity))),
      is_frozen: d.isFrozen,
    });
  }

  return {
    purchased_on: meta.purchasedOn,
    receipt_image_path: meta.receiptPath,
    item_photo_paths: meta.photoPaths,
    image_path: meta.photoPaths[0] ?? null,
    new_items: newItems,
    items,
  };
}
