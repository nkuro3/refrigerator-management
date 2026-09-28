// Gemini の出力を検証・正規化してアプリに返す形にする（Deno 固有の依存を持たない純粋関数）

export type Master = { id: string; name: string; aliases: string[]; category_id: number };

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
  itemMasterId: string | null; // 既存の品目。null のときは newItem を使う
  newItem: NewItemProposal | null;
};

export type AnalysisResult = {
  purchasedOn: string | null;
  items: Candidate[];
};

const SOURCES = ["both", "receipt_only", "photo_only"] as const;
const CONFIDENCES = ["high", "medium", "low"] as const;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function isValidDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

// 品目名・別名の完全一致で既存品目を探す（AIが既存品目を新規提案してしまった場合の救済）
function findMasterByName(name: string, masters: Master[]): Master | undefined {
  const n = name.replace(/\s/g, "");
  return masters.find((m) => m.name === n || m.aliases.includes(n));
}

export function normalizeAnalysis(
  raw: unknown,
  masters: Master[],
  categoryNames: readonly string[],
  today: string,
): AnalysisResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const otherCategoryId = categoryNames.indexOf("その他") + 1;

  let purchasedOn = str(obj.purchased_on);
  // 読み間違いで未来日や不正な日付になった場合は採用しない
  if (purchasedOn && (!isValidDate(purchasedOn) || purchasedOn > today)) purchasedOn = null;

  const items: Candidate[] = [];
  rawItems.forEach((value, i) => {
    const it = (value ?? {}) as Record<string, unknown>;
    const name = str(it.name) ?? str(it.receipt_text);
    if (!name) return;

    let confidence = pick(it.confidence, CONFIDENCES, "low");
    let itemMasterId: string | null = null;
    let newItem: NewItemProposal | null = null;

    const index = int(it.item_index);
    if (index !== null && index >= 0 && index < masters.length) {
      itemMasterId = masters[index].id;
    } else {
      const proposal = (it.new_item ?? null) as Record<string, unknown> | null;
      const proposedName = str(proposal?.name);
      const existing = proposedName ? findMasterByName(proposedName, masters) : undefined;
      if (existing) {
        itemMasterId = existing.id;
      } else if (proposal && proposedName) {
        const catIndex = categoryNames.indexOf(String(proposal.category));
        const shelfDays = int(proposal.shelf_days);
        const frozenDays = int(proposal.frozen_shelf_days);
        newItem = {
          name: proposedName.slice(0, 40),
          categoryId: catIndex >= 0 ? catIndex + 1 : otherCategoryId,
          shelfDays: clamp(shelfDays ?? 7, 1, 3650),
          frozenShelfDays: frozenDays === null ? null : clamp(frozenDays, 1, 3650),
        };
      } else {
        // 品目も提案もない場合は、商品名をそのまま「その他」の品目として提案する
        newItem = { name: name.slice(0, 40), categoryId: otherCategoryId, shelfDays: 7, frozenShelfDays: null };
        confidence = "low";
      }
    }

    const unitPrice = int(it.unit_price);
    items.push({
      key: `c${i}`,
      name: name.slice(0, 80),
      receiptText: str(it.receipt_text),
      quantity: clamp(int(it.quantity) ?? 1, 1, 50),
      unitPrice: unitPrice !== null && unitPrice >= 0 ? unitPrice : null,
      isFrozen: it.is_frozen === true,
      source: pick(it.source, SOURCES, "both"),
      confidence,
      itemMasterId,
      newItem,
    });
  });

  return { purchasedOn, items };
}

// Interactions API のレスポンスから最終テキストを取り出す
export function extractOutputText(response: unknown): string | null {
  const r = (response ?? {}) as Record<string, unknown>;
  if (typeof r.output_text === "string") return r.output_text;
  const steps = Array.isArray(r.steps) ? r.steps : [];
  const texts: string[] = [];
  for (const step of steps) {
    const s = step as Record<string, unknown>;
    if (s.type !== "model_output" || !Array.isArray(s.content)) continue;
    for (const c of s.content as Record<string, unknown>[]) {
      if (c.type === "text" && typeof c.text === "string") texts.push(c.text);
    }
  }
  return texts.length > 0 ? texts.join("") : null;
}
