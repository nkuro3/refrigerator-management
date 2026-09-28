import { describe, expect, it } from "vitest";
import { extractOutputText, type Master, normalizeAnalysis } from "./analyze-purchase/normalize";
import { CATEGORY_NAMES } from "./analyze-purchase/prompt";
import { buildAlertMessage } from "./expiry-alerts/message";

const masters: Master[] = [
  { id: "beef", name: "牛肉", aliases: ["牛こま"], category_id: 1 },
  { id: "vinegar", name: "酢", aliases: ["米酢", "穀物酢"], category_id: 8 },
];
const TODAY = "2026-09-28";

describe("normalizeAnalysis", () => {
  it("品目番号を品目IDに変換する", () => {
    const r = normalizeAnalysis({
      purchased_on: "2026-09-27",
      items: [{ receipt_text: "ギュウコマ", name: "牛こま切れ肉", item_index: 0, new_item: null, quantity: 1,
        unit_price: 598, is_frozen: false, source: "both", confidence: "high" }],
    }, masters, CATEGORY_NAMES, TODAY);
    expect(r.purchasedOn).toBe("2026-09-27");
    expect(r.items[0]).toMatchObject({ itemMasterId: "beef", unitPrice: 598, newItem: null });
  });

  it("新しい品目の提案を受け付け、既存品目と同名なら既存に寄せる", () => {
    const r = normalizeAnalysis({
      purchased_on: null,
      items: [
        { name: "ぬか漬けの素", item_index: null, quantity: 1, new_item: { name: "ぬか漬けの素", category: "調味料", shelf_days: 90, frozen_shelf_days: null } },
        { name: "米酢", item_index: null, quantity: 1, new_item: { name: "米酢", category: "調味料", shelf_days: 365, frozen_shelf_days: null } },
      ],
    }, masters, CATEGORY_NAMES, TODAY);
    expect(r.items[0]!.newItem).toEqual({ name: "ぬか漬けの素", categoryId: 8, shelfDays: 90, frozenShelfDays: null });
    expect(r.items[1]).toMatchObject({ itemMasterId: "vinegar", newItem: null });
  });

  it("範囲外の番号・不正な値を安全な値にする", () => {
    const r = normalizeAnalysis({
      purchased_on: "2099-01-01",
      items: [
        { name: "謎の食品", item_index: 99, quantity: 0, unit_price: -10, source: "x", confidence: "?" },
        { name: "" },
      ],
    }, masters, CATEGORY_NAMES, TODAY);
    expect(r.purchasedOn).toBeNull();
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      quantity: 1, unitPrice: null, source: "both", confidence: "low",
      itemMasterId: null, newItem: { name: "謎の食品", categoryId: 13 },
    });
  });

  it("壊れた入力でも例外にしない", () => {
    expect(normalizeAnalysis(null, masters, CATEGORY_NAMES, TODAY)).toEqual({ purchasedOn: null, items: [] });
  });
});

describe("extractOutputText", () => {
  it("steps の model_output からテキストを取り出す", () => {
    expect(extractOutputText({
      steps: [
        { type: "thought", content: [{ type: "text", text: "考え中" }] },
        { type: "model_output", content: [{ type: "text", text: '{"items":' }, { type: "text", text: "[]}" }] },
      ],
    })).toBe('{"items":[]}');
    expect(extractOutputText({ output_text: "x" })).toBe("x");
    expect(extractOutputText({})).toBeNull();
  });
});

describe("buildAlertMessage", () => {
  it("解凍済みを先頭に、件数と品目名をまとめる", () => {
    const m = buildAlertMessage([
      { household_id: "h", item_name: "豆腐", is_thawed: false, days_left: 1 },
      { household_id: "h", item_name: "牛肉", is_thawed: true, days_left: null },
      { household_id: "h", item_name: "牛乳", is_thawed: false, days_left: -1 },
    ]);
    expect(m).toEqual({ title: "使い切りアラート", body: "解凍済み1件・期限間近2件・うち期限切れ1件：牛肉、牛乳、豆腐" });
  });
  it("対象がなければ通知しない", () => {
    expect(buildAlertMessage([])).toBeNull();
  });
});
