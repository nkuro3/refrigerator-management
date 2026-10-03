// 冷蔵庫の更新通知の文面を作る（純粋関数）

export type ChangeEvent = {
  event_id: number;
  household_id: string;
  actor_id: string | null;
  actor_name: string;
  type: "created" | "remaining_changed" | "freeze_changed" | "expiry_edited" | "ended" | "end_undone";
  from_value: string | null;
  to_value: string | null;
  item_name: string;
};

// 通知するイベントの見出し（並び順もこの順）。期限の手修正・終了の取り消しは通知しない
const ACTIONS = ["登録", "使い切り", "廃棄", "冷凍", "解凍", "残りわずか", "残り数回"] as const;
type Action = (typeof ACTIONS)[number];

export function actionOf(e: ChangeEvent): Action | null {
  switch (e.type) {
    case "created":
      return "登録";
    case "ended":
      return e.to_value?.startsWith("discarded") ? "廃棄" : "使い切り";
    case "freeze_changed":
      return e.to_value === "frozen" ? "冷凍" : e.to_value === "thawed" ? "解凍" : null;
    case "remaining_changed":
      return e.to_value === "almost_empty" ? "残りわずか" : e.to_value === "few_left" ? "残り数回" : null;
    default:
      return null;
  }
}

// 同じ人・同じ世帯のまとまり
export type ChangeBatch = { householdId: string; actorId: string | null; actorName: string; events: ChangeEvent[] };

export function groupByActor(events: ChangeEvent[]): ChangeBatch[] {
  const batches = new Map<string, ChangeBatch>();
  for (const e of events) {
    if (!actionOf(e)) continue;
    const key = `${e.household_id}:${e.actor_id ?? ""}`;
    const b = batches.get(key) ?? { householdId: e.household_id, actorId: e.actor_id, actorName: e.actor_name, events: [] };
    b.events.push(e);
    batches.set(key, b);
  }
  return [...batches.values()];
}

// 例: title「りこさんが冷蔵庫を更新」 body「登録：牛乳、卵×2ほか3点／使い切り：豆腐」
export function buildChangeMessage(batch: ChangeBatch): { title: string; body: string } | null {
  const byAction = new Map<Action, Map<string, number>>();
  for (const e of batch.events) {
    const action = actionOf(e);
    if (!action) continue;
    const names = byAction.get(action) ?? new Map<string, number>();
    names.set(e.item_name, (names.get(e.item_name) ?? 0) + 1);
    byAction.set(action, names);
  }
  if (byAction.size === 0) return null;

  const parts = ACTIONS.filter((a) => byAction.has(a)).map((a) => {
    const names = [...byAction.get(a)!.entries()];
    const total = names.reduce((n, [, c]) => n + c, 0);
    const shown = names.slice(0, 3).map(([name, c]) => (c > 1 ? `${name}×${c}` : name));
    const shownCount = names.slice(0, 3).reduce((n, [, c]) => n + c, 0);
    const rest = total - shownCount;
    return `${a}：${shown.join("、")}${rest > 0 ? `ほか${rest}点` : ""}`;
  });

  const who = batch.actorId ? `${batch.actorName}さん` : "家族";
  return { title: `${who}が冷蔵庫を更新`, body: parts.join("／") };
}
