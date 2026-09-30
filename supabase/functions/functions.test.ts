import { describe, expect, it } from "vitest";
import { buildJevRequest, interpretJevAnswers, NONE_KEY } from "./analyze-purchase/jev";
import {
  extractResponsesText,
  type Master,
  normalizeExtraction,
  resolveCandidate,
} from "./analyze-purchase/normalize";
import { CATEGORY_NAMES, EXTRACTION_SCHEMA } from "./analyze-purchase/prompt";
import { buildAlertMessage } from "./expiry-alerts/message";

const masters: Master[] = [
  { id: "beef", name: "牛肉", aliases: ["牛こま"], category_id: 1 },
  { id: "vinegar", name: "酢", aliases: ["米酢", "穀物酢"], category_id: 8 },
  { id: "ponzu", name: "ポン酢", aliases: [], category_id: 8 },
];
const TODAY = "2026-09-28";

const rawItem = (over: Record<string, unknown> = {}) => ({
  receipt_text: "コクモツス", name: "ミツカン穀物酢", generic_name: "酢", category: "調味料",
  shelf_days: 730, frozen_shelf_days: null, quantity: 2, unit_price: 198, is_frozen: false,
  source: "both", confidence: "high", ...over,
});

describe("抽出スキーマ（OpenAI strict）", () => {
  it("すべてのオブジェクトで全プロパティが required、additionalProperties は false", () => {
    const check = (s: Record<string, unknown>) => {
      if (s.type === "object") {
        expect(s.additionalProperties).toBe(false);
        expect([...(s.required as string[])].sort()).toEqual(Object.keys(s.properties as object).sort());
        Object.values(s.properties as Record<string, Record<string, unknown>>).forEach(check);
      }
      if (s.type === "array") check(s.items as Record<string, unknown>);
    };
    check(EXTRACTION_SCHEMA as unknown as Record<string, unknown>);
  });
});

describe("normalizeExtraction", () => {
  it("正常な出力を正規化する", () => {
    const r = normalizeExtraction({ purchased_on: "2026-09-27", items: [rawItem()] }, CATEGORY_NAMES, TODAY);
    expect(r.purchasedOn).toBe("2026-09-27");
    expect(r.items[0]).toMatchObject({
      name: "ミツカン穀物酢", genericName: "酢", quantity: 2, unitPrice: 198,
      proposal: { name: "酢", categoryId: 8, shelfDays: 730, frozenShelfDays: null },
    });
  });
  it("範囲外・不正な値を安全な値にし、名前のない行を捨てる", () => {
    const r = normalizeExtraction({
      purchased_on: "2099-01-01",
      items: [rawItem({ quantity: 0, unit_price: -10, source: "x", confidence: "?", category: "謎", generic_name: "" }), { name: "" }],
    }, CATEGORY_NAMES, TODAY);
    expect(r.purchasedOn).toBeNull();
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      quantity: 1, unitPrice: null, source: "both", confidence: "low",
      genericName: "ミツカン穀物酢", proposal: { categoryId: 13 },
    });
  });
  it("壊れた入力でも例外にしない", () => {
    expect(normalizeExtraction(null, CATEGORY_NAMES, TODAY)).toEqual({ purchasedOn: null, items: [] });
  });
});

describe("Jev の質問と判定", () => {
  const item = { name: "ミツカン穀物酢", receiptText: "コクモツス", genericName: "酢", isFrozen: false };

  it("カテゴリの質問と、カテゴリごとの品目の質問（該当なし付き）を作る", () => {
    const { request, index } = buildJevRequest(item, masters, CATEGORY_NAMES, "jev-latest");
    expect(Object.keys(request.questions).sort()).toEqual(["category", "item_1", "item_8"]);
    expect(Object.keys(request.questions.category!.criteria)).toHaveLength(CATEGORY_NAMES.length);
    expect(request.questions.item_8!.criteria).toMatchObject({ 酢: "酢。別名：米酢、穀物酢", [NONE_KEY]: expect.any(String) });
    expect(index.get("item_8")!.get("ポン酢")).toBe("ponzu");
    expect(request.state).toMatchObject({ 商品名: "ミツカン穀物酢", 一般名: "酢", レシートの表記: "コクモツス" });
  });

  it("同名の品目（共通と家族で追加）はキーを分ける", () => {
    const { index } = buildJevRequest(item, [...masters, { id: "vinegar2", name: "酢", aliases: [], category_id: 8 }], CATEGORY_NAMES, "jev-latest");
    expect(index.get("item_8")!.get("酢（家族で追加）")).toBe("vinegar2");
  });

  it("P(カテゴリ)×P(品目) が最大の品目を選ぶ（カテゴリを取り違えても拾える）", () => {
    const { index } = buildJevRequest(item, masters, CATEGORY_NAMES, "jev-latest");
    const j = interpretJevAnswers({
      category: { choice: "肉", probabilities: { 肉: 0.55, 調味料: 0.45 } },
      item_1: { choice: NONE_KEY, probabilities: { 牛肉: 0.05, [NONE_KEY]: 0.95 } },
      item_8: { choice: "酢", probabilities: { 酢: 0.95, ポン酢: 0.03, [NONE_KEY]: 0.02 } },
    }, index, CATEGORY_NAMES);
    // 酢: 0.45×0.95=0.4275 ／ 該当なし: 0.55×0.95+0.45×0.02=0.5315 → 該当なしが勝つ
    expect(j.itemMasterId).toBeNull();

    const j2 = interpretJevAnswers({
      category: { choice: "調味料", probabilities: { 肉: 0.1, 調味料: 0.9 } },
      item_1: { choice: NONE_KEY, probabilities: { 牛肉: 0.1, [NONE_KEY]: 0.9 } },
      item_8: { choice: "酢", probabilities: { 酢: 0.95, ポン酢: 0.04, [NONE_KEY]: 0.01 } },
    }, index, CATEGORY_NAMES);
    expect(j2.itemMasterId).toBe("vinegar");
    expect(j2.confidence).toBeCloseTo(0.855);
  });

  it("probabilities がなければ choice と confidence で判断する", () => {
    const { index } = buildJevRequest(item, masters, CATEGORY_NAMES, "jev-latest");
    const j = interpretJevAnswers({
      category: { choice: "調味料", confidence: 0.9 },
      item_8: { choice: "ポン酢", confidence: 0.8 },
    }, index, CATEGORY_NAMES);
    expect(j.itemMasterId).toBe("ponzu");
    expect(interpretJevAnswers(undefined, index, CATEGORY_NAMES)).toEqual({ itemMasterId: null, confidence: 0 });
  });
});

describe("resolveCandidate", () => {
  const [item] = normalizeExtraction({ items: [rawItem()] }, CATEGORY_NAMES, TODAY).items;
  const nuka = normalizeExtraction({
    items: [rawItem({ name: "ぬか漬けの素", generic_name: "ぬか漬けの素", shelf_days: 90 })],
  }, CATEGORY_NAMES, TODAY).items[0]!;

  it("Jev が選んだ品目を使い、自信度は低い方に合わせる", () => {
    expect(resolveCandidate(item!, { itemMasterId: "vinegar", confidence: 0.9 }, masters))
      .toMatchObject({ itemMasterId: "vinegar", newItem: null, confidence: "high" });
    expect(resolveCandidate(item!, { itemMasterId: "vinegar", confidence: 0.6 }, masters).confidence).toBe("medium");
  });
  it("Jev が失敗したら一般名の一致で既存品目を探す", () => {
    expect(resolveCandidate(item!, null, masters)).toMatchObject({ itemMasterId: "vinegar", confidence: "medium" });
  });
  it("該当なしなら抽出時の提案を新しい品目にする", () => {
    expect(resolveCandidate(nuka, { itemMasterId: null, confidence: 0.9 }, masters)).toMatchObject({
      itemMasterId: null,
      newItem: { name: "ぬか漬けの素", categoryId: 8, shelfDays: 90 },
      confidence: "high",
    });
  });
});

describe("extractResponsesText", () => {
  it("output の message から output_text を取り出す", () => {
    expect(extractResponsesText({
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text: '{"items":' }, { type: "output_text", text: "[]}" }] },
      ],
    })).toBe('{"items":[]}');
    expect(extractResponsesText({ output_text: "x" })).toBe("x");
    expect(extractResponsesText({ output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] })).toBeNull();
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
