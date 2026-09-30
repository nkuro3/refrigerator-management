// 抽出（gpt-6-luna）に渡す指示と出力スキーマ
// 品目マスタは渡さない。品目の判定は Jev が担当する（jev.ts）

export const CATEGORY_NAMES = [
  "肉", "魚介", "野菜", "果物", "卵・乳製品", "豆腐・大豆製品", "主食",
  "調味料", "油・粉・乾物", "惣菜・加工品", "お菓子", "飲料", "その他",
] as const;

export const EXTRACTION_INSTRUCTION = `
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
6. generic_name は、買い物リストに書くときの短い一般名です（例：「牛肉」「酢」「レタス」「うどん」）。
   ブランド・容量・部位・種類の違いは含めません（米酢も穀物酢も「酢」、牛こまも牛ステーキも「牛肉」）。
   冷凍食品は中身の名前にします（冷凍うどん → 「うどん」）。
   料理に使う酒類は飲み物ではなく調味料です（料理酒・料理清酒 → 「料理酒」、みりん・みりん風調味料 → 「みりん」、category は「調味料」）。
7. category は generic_name のカテゴリをカテゴリ一覧から選びます。
   shelf_days は購入日から食べきる目安の日数（未開封・冷蔵または常温）、
   frozen_shelf_days は家庭で冷凍した場合の目安の日数です（冷凍に向かないものは null）。
8. is_frozen は、冷凍食品として売られているもの（冷凍で売られていた、パッケージに冷凍食品とある）だけ true にします。
9. 賞味期限・消費期限の印字は読まなくてかまいません。
10. confidence は商品の読み取りと対応づけにどれくらい自信があるかです（high / medium / low）。
11. purchased_on はレシートの購入日（YYYY-MM-DD）です。レシートがない、または読めない場合は null にします。

カテゴリ一覧: ${CATEGORY_NAMES.join("、")}
`.trim();

export function buildUserText(hasReceipt: boolean, photoCount: number): string {
  return `画像: ${hasReceipt ? "1枚目がレシート、" : "レシートなし、"}${
    photoCount > 0 ? `残り${photoCount}枚が買ってきた食品の写真` : "食品の写真なし"
  }`;
}

// OpenAI の Structured Outputs（strict）用: すべてのプロパティを required にし、additionalProperties は false
export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    purchased_on: { type: ["string", "null"], description: "購入日 YYYY-MM-DD" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          receipt_text: { type: ["string", "null"], description: "レシートの行の表記" },
          name: { type: "string" },
          generic_name: { type: "string" },
          category: { type: "string", enum: [...CATEGORY_NAMES] },
          shelf_days: { type: "integer" },
          frozen_shelf_days: { type: ["integer", "null"] },
          quantity: { type: "integer" },
          unit_price: { type: ["integer", "null"] },
          is_frozen: { type: "boolean" },
          source: { type: "string", enum: ["both", "receipt_only", "photo_only"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: [
          "receipt_text", "name", "generic_name", "category", "shelf_days", "frozen_shelf_days",
          "quantity", "unit_price", "is_frozen", "source", "confidence",
        ],
      },
    },
  },
  required: ["purchased_on", "items"],
} as const;
