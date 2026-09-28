import type { DiscardReason, EndReason, FreezeState, RemainingLevel } from "./types";

export const REMAINING_LABELS: Record<RemainingLevel, string> = {
  unopened: "未開封",
  few_left: "残り数回",
  almost_empty: "残りわずか",
};
export const REMAINING_ORDER: RemainingLevel[] = ["unopened", "few_left", "almost_empty"];

export const FREEZE_LABELS: Record<FreezeState, string> = {
  none: "冷凍なし",
  frozen: "冷凍中",
  thawed: "解凍済み",
};

export const END_REASON_LABELS: Record<EndReason, string> = {
  used_up: "使い切った",
  discarded: "捨てた",
};

export const DISCARD_REASON_LABELS: Record<DiscardReason, string> = {
  expired: "期限切れ",
  spoiled: "傷み",
  other: "その他",
};

// categories テーブルの id（1始まり）と同じ順番
export const CATEGORY_NAMES = [
  "肉", "魚介", "野菜", "果物", "卵・乳製品", "豆腐・大豆製品", "主食",
  "調味料", "油・粉・乾物", "惣菜・加工品", "お菓子", "飲料", "その他",
] as const;

export function categoryName(id: number): string {
  return CATEGORY_NAMES[id - 1] ?? "その他";
}

// 期限間近とみなす日数（仕様: 3日以内）
export const EXPIRING_WITHIN_DAYS = 3;
