// 冷蔵庫の更新通知: pg_cron から毎分（未通知の変更があるときだけ）呼ばれる
// 家族の誰かが登録・使い切り・廃棄・冷凍／解凍・残量変更をしたら、操作した本人以外のメンバーに知らせる
// 1分以内の操作は人ごとに1通にまとめる
import { createClient } from "npm:@supabase/supabase-js@2";
import { type PushMessage, sendToUsers } from "../_shared/push.ts";
import { buildChangeMessage, type ChangeEvent, groupByActor } from "./message.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("Authorization") !== `Bearer ${secret}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 未通知のイベントを取り出す（取り出した時点で通知済みになる）
  const { data: events, error } = await admin.rpc("claim_change_events");
  if (error) return json({ error: error.message }, 500);
  const batches = groupByActor((events ?? []) as ChangeEvent[]);
  if (batches.length === 0) return json({ events: events?.length ?? 0, sent: 0 });

  // 通知先: 同じ世帯で、更新通知をオンにしているメンバー
  const householdIds = [...new Set(batches.map((b) => b.householdId))];
  const { data: allMembers, error: mErr } = await admin
    .from("household_members").select("user_id, household_id").in("household_id", householdIds);
  if (mErr) return json({ error: mErr.message }, 500);
  const { data: optedOut, error: pErr } = await admin
    .from("profiles").select("user_id").eq("notify_changes", false)
    .in("user_id", (allMembers ?? []).map((m) => m.user_id));
  if (pErr) return json({ error: pErr.message }, 500);
  const off = new Set((optedOut ?? []).map((p) => p.user_id as string));
  const members = (allMembers ?? []).filter((m) => !off.has(m.user_id as string));

  const messages = new Map<string, PushMessage[]>();
  for (const b of batches) {
    const msg = buildChangeMessage(b);
    if (!msg) continue;
    for (const m of members) {
      if (m.household_id !== b.householdId || m.user_id === b.actorId) continue; // 本人には送らない
      const list = messages.get(m.user_id) ?? [];
      list.push({ ...msg, url: "/", tag: `change-${b.events[0]!.event_id}` });
      messages.set(m.user_id, list);
    }
  }

  try {
    const r = await sendToUsers(admin, messages);
    return json({ events: events?.length ?? 0, batches: batches.length, sent: r.sentApp + r.sentWeb, ...r });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
