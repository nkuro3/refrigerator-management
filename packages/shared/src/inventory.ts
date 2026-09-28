import { daysBetween, shortDate } from "./dates";
import { EXPIRING_WITHIN_DAYS } from "./labels";
import type { ProductWithItem } from "./types";

export type ExpiryKind = "thawed" | "expired" | "soon" | "frozen" | "ok" | "unknown";

export type ExpiryStatus = {
  kind: ExpiryKind;
  daysLeft: number | null;
  label: string;
};

type ExpiryInput = Pick<ProductWithItem, "freeze_state" | "expires_on" | "expires_is_estimated">;

export function expiryStatus(p: ExpiryInput, today: string): ExpiryStatus {
  if (p.freeze_state === "thawed") {
    return { kind: "thawed", daysLeft: null, label: "解凍済み・早めに使い切り" };
  }
  if (!p.expires_on) return { kind: "unknown", daysLeft: null, label: "期限未設定" };

  const daysLeft = daysBetween(today, p.expires_on);
  const suffix = p.expires_is_estimated ? "（推定）" : "";
  if (daysLeft < 0) return { kind: "expired", daysLeft, label: `期限切れ（${-daysLeft}日前）${suffix}` };
  if (daysLeft <= EXPIRING_WITHIN_DAYS) {
    const label = daysLeft === 0 ? `今日まで${suffix}` : `あと${daysLeft}日${suffix}`;
    return { kind: "soon", daysLeft, label };
  }
  if (p.freeze_state === "frozen") {
    return { kind: "frozen", daysLeft, label: `冷凍中・${shortDate(p.expires_on)}まで${suffix}` };
  }
  return { kind: "ok", daysLeft, label: `${shortDate(p.expires_on)}まで${suffix}` };
}

// 使い切りを優先すべき順: 解凍済み → 期限の近い順 → 期限なし
export function urgencyScore(p: ExpiryInput, today: string): number {
  if (p.freeze_state === "thawed") return -1_000_000;
  if (!p.expires_on) return 1_000_000;
  return daysBetween(today, p.expires_on);
}

export function sortByUrgency<T extends ExpiryInput>(products: T[], today: string): T[] {
  return [...products].sort((a, b) => urgencyScore(a, today) - urgencyScore(b, today));
}

export function isAlertTarget(p: ExpiryInput, today: string): boolean {
  const s = expiryStatus(p, today);
  return s.kind === "thawed" || s.kind === "expired" || s.kind === "soon";
}

export type ItemGroup = {
  itemMasterId: string;
  itemName: string;
  categoryId: number;
  products: ProductWithItem[]; // 使い切り優先順
  count: number;
};

// 品目ビュー: 同じ品目の商品をまとめる（例: お酢 ×2）
export function groupByItem(products: ProductWithItem[], today: string): ItemGroup[] {
  const map = new Map<string, ItemGroup>();
  for (const p of products) {
    const g = map.get(p.item_master_id) ?? {
      itemMasterId: p.item_master_id,
      itemName: p.item_masters.name,
      categoryId: p.item_masters.category_id,
      products: [],
      count: 0,
    };
    g.products.push(p);
    g.count++;
    map.set(p.item_master_id, g);
  }
  const groups = [...map.values()].map((g) => ({ ...g, products: sortByUrgency(g.products, today) }));
  return groups.sort((a, b) => {
    const d = urgencyScore(a.products[0]!, today) - urgencyScore(b.products[0]!, today);
    return d !== 0 ? d : a.itemName.localeCompare(b.itemName, "ja");
  });
}

// 商品ビュー: 同じ商品名・同じ状態のものを「×2」にまとめる
export type ProductGroup = { key: string; products: ProductWithItem[] };

export function groupSameProducts(products: ProductWithItem[], today: string): ProductGroup[] {
  const map = new Map<string, ProductWithItem[]>();
  for (const p of sortByUrgency(products, today)) {
    const key = [p.name, p.purchased_on, p.remaining, p.freeze_state, p.expires_on ?? ""].join("|");
    map.set(key, [...(map.get(key) ?? []), p]);
  }
  return [...map.entries()].map(([key, ps]) => ({ key, products: ps }));
}
