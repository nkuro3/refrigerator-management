// 抽出結果（gpt-6-luna）と品目の判定結果（Jev）をまとめて、アプリに返す形にする（Deno 固有の依存を持たない純粋関数）
// 結果型は packages/shared/src/types.ts の Candidate / AnalysisResult と揃えること

import type { Judgement, Master } from "./jev.ts";

export type { Master };

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

// 抽出した1件（検証・正規化済み）
export type ExtractedItem = {
  key: string;
  name: string;
  receiptText: string | null;
  genericName: string;
  proposal: NewItemProposal; // 該当する品目がなかったときの新しい品目の提案
  quantity: number;
  unitPrice: number | null;
  isFrozen: boolean;
  source: Candidate["source"];
  confidence: Candidate["confidence"];
};

export type Extraction = { purchasedOn: string | null; items: ExtractedItem[] };

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

// gpt-6-luna の出力を検証・正規化する
export function normalizeExtraction(raw: unknown, categoryNames: readonly string[], today: string): Extraction {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const otherCategoryId = categoryNames.indexOf("その他") + 1;

  let purchasedOn = str(obj.purchased_on);
  // 読み間違いで未来日や不正な日付になった場合は採用しない
  if (purchasedOn && (!isValidDate(purchasedOn) || purchasedOn > today)) purchasedOn = null;

  const items: ExtractedItem[] = [];
  rawItems.forEach((value, i) => {
    const it = (value ?? {}) as Record<string, unknown>;
    const name = str(it.name) ?? str(it.receipt_text);
    if (!name) return;
    const genericName = (str(it.generic_name) ?? name).slice(0, 40);
    const catIndex = categoryNames.indexOf(String(it.category));
    const shelfDays = int(it.shelf_days);
    const frozenDays = int(it.frozen_shelf_days);
    const unitPrice = int(it.unit_price);

    items.push({
      key: `c${i}`,
      name: name.slice(0, 80),
      receiptText: str(it.receipt_text),
      genericName,
      proposal: {
        name: genericName,
        categoryId: catIndex >= 0 ? catIndex + 1 : otherCategoryId,
        shelfDays: clamp(shelfDays ?? 7, 1, 3650),
        frozenShelfDays: frozenDays === null ? null : clamp(frozenDays, 1, 3650),
      },
      quantity: clamp(int(it.quantity) ?? 1, 1, 50),
      unitPrice: unitPrice !== null && unitPrice >= 0 ? unitPrice : null,
      isFrozen: it.is_frozen === true,
      source: pick(it.source, SOURCES, "both"),
      confidence: pick(it.confidence, CONFIDENCES, "low"),
    });
  });

  return { purchasedOn, items };
}

// 品目名・別名の完全一致で既存品目を探す（Jev が使えないときの代わり、新規提案が既存品目と同名のときの救済）
export function findMasterByName(name: string, masters: Master[]): Master | undefined {
  const n = name.replace(/\s/g, "");
  return masters.find((m) => m.name === n || m.aliases.includes(n));
}

const RANK = { high: 2, medium: 1, low: 0 } as const;
const lower = (a: Candidate["confidence"], b: Candidate["confidence"]) => (RANK[a] <= RANK[b] ? a : b);

function judgementLevel(confidence: number): Candidate["confidence"] {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

// 抽出1件と Jev の判定（なければ null）から、確認画面に出す候補を作る
export function resolveCandidate(item: ExtractedItem, judgement: Judgement | null, masters: Master[]): Candidate {
  let itemMasterId: string | null = null;
  let judged: Candidate["confidence"];

  if (judgement?.itemMasterId && masters.some((m) => m.id === judgement.itemMasterId)) {
    itemMasterId = judgement.itemMasterId;
    judged = judgementLevel(judgement.confidence);
  } else {
    // Jev が「該当なし」または失敗: 一般名が既存品目と一致すればそれを使い、なければ新しい品目を提案する
    const existing = findMasterByName(item.genericName, masters);
    itemMasterId = existing?.id ?? null;
    judged = existing ? "medium" : judgement ? judgementLevel(judgement.confidence) : "low";
  }

  return {
    key: item.key,
    name: item.name,
    receiptText: item.receiptText,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    isFrozen: item.isFrozen,
    source: item.source,
    confidence: lower(item.confidence, judged),
    itemMasterId,
    newItem: itemMasterId ? null : item.proposal,
  };
}

// OpenAI Responses API のレスポンスから最終テキストを取り出す
// 拒否（refusal）された場合は null
export function extractResponsesText(response: unknown): string | null {
  const r = (response ?? {}) as Record<string, unknown>;
  if (typeof r.output_text === "string" && r.output_text !== "") return r.output_text;
  const output = Array.isArray(r.output) ? r.output : [];
  const texts: string[] = [];
  for (const item of output) {
    const o = item as Record<string, unknown>;
    if (o.type !== "message" || !Array.isArray(o.content)) continue;
    for (const c of o.content as Record<string, unknown>[]) {
      if (c.type === "output_text" && typeof c.text === "string") texts.push(c.text);
    }
  }
  return texts.length > 0 ? texts.join("") : null;
}
