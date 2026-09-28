// 使い切りアラートの文面を作る（純粋関数）

export type ExpiringRow = {
  household_id: string;
  item_name: string;
  is_thawed: boolean;
  days_left: number | null;
};

export type AlertMessage = { title: string; body: string } | null;

export function buildAlertMessage(rows: ExpiringRow[]): AlertMessage {
  if (rows.length === 0) return null;

  const thawed = rows.filter((r) => r.is_thawed);
  const expiring = rows.filter((r) => !r.is_thawed);
  const expired = expiring.filter((r) => r.days_left !== null && r.days_left < 0);

  // 解凍済み → 期限の近い順に品目名を並べ、重複を除いて最大4つ
  const ordered = [
    ...thawed,
    ...[...expiring].sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0)),
  ];
  const names = [...new Set(ordered.map((r) => r.item_name))];
  const shown = names.slice(0, 4).join("、") + (names.length > 4 ? "ほか" : "");

  const parts: string[] = [];
  if (thawed.length > 0) parts.push(`解凍済み${thawed.length}件`);
  if (expiring.length > 0) parts.push(`期限間近${expiring.length}件`);
  if (expired.length > 0) parts.push(`うち期限切れ${expired.length}件`);

  return { title: "使い切りアラート", body: `${parts.join("・")}：${shown}` };
}
