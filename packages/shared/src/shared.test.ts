import { describe, expect, it } from "vitest";
import { addDays, daysBetween, monthRange, shiftMonth, todayJst } from "./dates";
import { expiryStatus, groupByItem, groupSameProducts, isAlertTarget, sortByUrgency } from "./inventory";
import { buildRegisterPayload, DraftError, type DraftItem, toDraftItems } from "./purchase";
import type { ProductWithItem } from "./types";

const TODAY = "2026-09-28";

function product(over: Partial<ProductWithItem> & { itemName?: string }): ProductWithItem {
  const { itemName = "牛肉", ...rest } = over;
  return {
    id: Math.random().toString(36),
    household_id: "h",
    purchase_id: null,
    item_master_id: itemName,
    name: itemName,
    image_path: null,
    price: null,
    purchased_on: "2026-09-25",
    remaining: "unopened",
    freeze_state: "none",
    freeze_changed_on: null,
    expires_on: "2026-10-10",
    expires_is_estimated: true,
    ended_at: null,
    end_reason: null,
    discard_reason: null,
    created_at: "2026-09-25T00:00:00Z",
    item_masters: { name: itemName, category_id: 1 },
    ...rest,
  };
}

describe("dates", () => {
  it("日本時間の今日を返す", () => {
    expect(todayJst(new Date("2026-09-27T15:30:00Z"))).toBe("2026-09-28");
    expect(todayJst(new Date("2026-09-27T14:59:00Z"))).toBe("2026-09-27");
  });
  it("日付の計算", () => {
    expect(daysBetween("2026-09-28", "2026-10-01")).toBe(3);
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});

describe("expiryStatus", () => {
  it("解凍済みは期限に関係なく使い切り対象", () => {
    const s = expiryStatus(product({ freeze_state: "thawed", expires_on: null }), TODAY);
    expect(s.kind).toBe("thawed");
    expect(isAlertTarget(product({ freeze_state: "thawed", expires_on: null }), TODAY)).toBe(true);
  });
  it("3日以内は期限間近、過ぎたら期限切れ", () => {
    expect(expiryStatus(product({ expires_on: "2026-10-01" }), TODAY)).toMatchObject({ kind: "soon", daysLeft: 3 });
    expect(expiryStatus(product({ expires_on: "2026-10-02" }), TODAY).kind).toBe("ok");
    expect(expiryStatus(product({ expires_on: "2026-09-28" }), TODAY).label).toBe("今日まで（推定）");
    expect(expiryStatus(product({ expires_on: "2026-09-26", expires_is_estimated: false }), TODAY).label)
      .toBe("期限切れ（2日前）");
  });
  it("冷凍中で期限が遠いものはアラート対象外", () => {
    const p = product({ freeze_state: "frozen", expires_on: "2026-10-28" });
    expect(expiryStatus(p, TODAY).kind).toBe("frozen");
    expect(isAlertTarget(p, TODAY)).toBe(false);
  });
});

describe("並び替えとグループ化", () => {
  it("解凍済み → 期限の近い順 → 期限なし", () => {
    const a = product({ name: "a", expires_on: "2026-10-05" });
    const b = product({ name: "b", freeze_state: "thawed", expires_on: null });
    const c = product({ name: "c", expires_on: null });
    const d = product({ name: "d", expires_on: "2026-09-29" });
    expect(sortByUrgency([a, b, c, d], TODAY).map((p) => p.name)).toEqual(["b", "d", "a", "c"]);
  });
  it("品目ビューは同じ品目をまとめる", () => {
    const groups = groupByItem([
      product({ itemName: "酢", name: "ミツカン穀物酢" }),
      product({ itemName: "酢", name: "タマノイ米酢", expires_on: "2026-09-30" }),
      product({ itemName: "牛肉" }),
    ], TODAY);
    expect(groups[0]).toMatchObject({ itemName: "酢", count: 2 });
    expect(groups[0]!.products[0]!.name).toBe("タマノイ米酢");
  });
  it("商品ビューは同じ商品・同じ状態を×2にまとめる", () => {
    const groups = groupSameProducts([
      product({ name: "穀物酢" }),
      product({ name: "穀物酢" }),
      product({ name: "穀物酢", remaining: "few_left" }),
    ], TODAY);
    expect(groups.map((g) => g.products.length).sort()).toEqual([1, 2]);
  });
});

describe("buildRegisterPayload", () => {
  const drafts: DraftItem[] = toDraftItems([
    { key: "c0", name: "ミツカン穀物酢", receiptText: "コクモツス", quantity: 2, unitPrice: 198, isFrozen: false,
      source: "both", confidence: "high", itemMasterId: "vinegar", newItem: null },
    { key: "c1", name: "ぬか漬けの素", receiptText: null, quantity: 1, unitPrice: null, isFrozen: false,
      source: "photo_only", confidence: "medium", itemMasterId: null,
      newItem: { name: "ぬか漬けの素", categoryId: 8, shelfDays: 90, frozenShelfDays: null } },
    { key: "c2", name: "ぬか漬けの素 詰め替え", receiptText: null, quantity: 1, unitPrice: 300, isFrozen: false,
      source: "both", confidence: "high", itemMasterId: null,
      newItem: { name: "ぬか漬けの素", categoryId: 8, shelfDays: 90, frozenShelfDays: null } },
    { key: "c3", name: "レジ袋", receiptText: "レジブクロ", quantity: 1, unitPrice: 5, isFrozen: false,
      source: "receipt_only", confidence: "low", itemMasterId: "other", newItem: null },
  ]);
  drafts[3]!.include = false;

  it("除外した行を除き、同じ新しい品目は1つにまとめる", () => {
    const payload = buildRegisterPayload(drafts, { purchasedOn: TODAY, receiptPath: "h/r.jpg", photoPaths: ["h/p.jpg"] });
    expect(payload.items).toHaveLength(3);
    expect(payload.new_items).toHaveLength(1);
    expect(payload.items[1]!.new_item_key).toBe("n1");
    expect(payload.items[2]!.new_item_key).toBe("n1");
    expect(payload.image_path).toBe("h/p.jpg");
  });
  it("品目がない行はエラー", () => {
    const bad = drafts.map((d) => (d.key === "c1" ? { ...d, newItem: null } : d));
    expect(() => buildRegisterPayload(bad, { purchasedOn: TODAY, receiptPath: null, photoPaths: [] }))
      .toThrow(DraftError);
  });
});
