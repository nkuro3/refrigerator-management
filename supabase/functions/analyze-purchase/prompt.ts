// Gemini に渡す指示と出力スキーマ

export const CATEGORY_NAMES = [
  "肉", "魚介", "野菜", "果物", "卵・乳製品", "豆腐・大豆製品", "主食",
  "調味料", "油・粉・乾物", "惣菜・加工品", "お菓子", "飲料", "その他",
] as const;

export const SYSTEM_INSTRUCTION = `
あなたは家族で使う冷蔵庫管理アプリの登録アシスタントです。
買い物のレシート画像と、買ってきた食品をテーブルに並べて撮った写真が渡されます（どちらか一方だけの場合もあります）。
レシートと写真を照らし合わせて、買った食品を一覧にしてください。

# ルール
1. 対象は食品と飲料だけです。レジ袋、割引・値引きの行、小計・合計・税・ポイント、日用品など食品以外は含めません。
2. レシートの行と写真の商品を対応づけます。
   - 両方で確認できたものは source を "both" にします。
   - レシートにだけあるもの（すでに片付けた商品など）は "receipt_only"、写真にだけあるものは "photo_only" にします。
3. 同じ商品を複数買った場合（「×2」「2コ」や同じ行が続く場合）は1件にまとめ、quantity に個数を入れます。
4. unit_price は1個あたりの価格（円・整数）です。値引きがあれば値引き後の価格にします。分からなければ null にします。
5. name は商品名です。写真で商品名が読めればそれを使い、読めなければレシートの略称を普通の表記に直します（例：「ギュウコマ」→「牛こま切れ肉」）。
6. item_index は、下の「品目リスト」から最も合う品目の番号です。
   - 品目は「買い物リストに書く言葉」の粒度です。種類の違い（米酢と穀物酢、絹豆腐と木綿豆腐）は同じ品目にします。
   - 別名も参考にします。冷凍食品は中身の品目にします（冷凍うどん → うどん、冷凍餃子 → 餃子）。
   - 合う品目がないときだけ item_index を null にし、new_item に新しい品目を提案します。合う品目があるときは new_item を null にします。
7. new_item の name はブランドや容量を含まない短い一般名にします（例：「ぬか漬けの素」「オートミール」）。
   category はカテゴリ一覧から選び、shelf_days は購入日から食べきる目安の日数（未開封・冷蔵または常温）、
   frozen_shelf_days は家庭で冷凍した場合の目安の日数です（冷凍に向かないものは null）。
8. is_frozen は、冷凍食品として売られているもの（冷凍で売られていた、パッケージに冷凍食品とある）だけ true にします。
9. 賞味期限・消費期限の印字は読まなくてかまいません。
10. confidence は対応づけと品目の判定にどれくらい自信があるかです（high / medium / low）。
11. purchased_on はレシートの購入日（YYYY-MM-DD）です。レシートがない、または読めない場合は null にします。
`.trim();

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    purchased_on: { type: ["string", "null"], description: "購入日 YYYY-MM-DD" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          receipt_text: { type: ["string", "null"], description: "レシートの行の表記" },
          name: { type: "string" },
          item_index: { type: ["integer", "null"] },
          new_item: {
            type: ["object", "null"],
            properties: {
              name: { type: "string" },
              category: { type: "string", enum: [...CATEGORY_NAMES] },
              shelf_days: { type: "integer" },
              frozen_shelf_days: { type: ["integer", "null"] },
            },
            required: ["name", "category", "shelf_days", "frozen_shelf_days"],
          },
          quantity: { type: "integer" },
          unit_price: { type: ["integer", "null"] },
          is_frozen: { type: "boolean" },
          source: { type: "string", enum: ["both", "receipt_only", "photo_only"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: [
          "receipt_text", "name", "item_index", "new_item", "quantity",
          "unit_price", "is_frozen", "source", "confidence",
        ],
      },
    },
  },
  required: ["purchased_on", "items"],
} as const;

export type CatalogEntry = { name: string; category: string; aliases: string[] };

// 品目リスト（番号・品目名・カテゴリ・別名）をタブ区切りで渡す
export function buildUserPrompt(catalog: CatalogEntry[], hasReceipt: boolean, photoCount: number): string {
  const lines = catalog.map((c, i) => `${i}\t${c.name}\t${c.category}\t${c.aliases.join("、")}`);
  return [
    `画像: ${hasReceipt ? "1枚目がレシート、" : "レシートなし、"}${photoCount > 0 ? `残り${photoCount}枚が買ってきた食品の写真` : "食品の写真なし"}`,
    `カテゴリ一覧: ${CATEGORY_NAMES.join("、")}`,
    "品目リスト（番号\t品目名\tカテゴリ\t別名）:",
    ...lines,
  ].join("\n");
}
