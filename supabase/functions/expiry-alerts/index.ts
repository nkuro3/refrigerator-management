// 使い切りアラート: pg_cron から毎時呼ばれ、通知時刻（日本時間）が来たユーザーの端末にプッシュ通知を送る
// 通知は世帯メンバー全員に送る（各自の notify_hour に届く）
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildAlertMessage, type ExpiringRow } from "./message.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("Authorization") !== `Bearer ${secret}`) {
    return json({ error: "unauthorized" }, 401);
  }

  // テスト用に { "hour": 8 } で時刻を指定できる
  const body = await req.json().catch(() => ({})) as { hour?: unknown };
  const jstHour = typeof body.hour === "number"
    ? body.hour
    : new Date(Date.now() + 9 * 3600_000).getUTCHours();

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 今の時刻に通知するユーザーと、その世帯・端末
  const { data: profiles, error: pErr } = await admin
    .from("profiles").select("user_id").eq("notify_hour", jstHour);
  if (pErr) return json({ error: pErr.message }, 500);
  const userIds = (profiles ?? []).map((p) => p.user_id as string);
  if (userIds.length === 0) return json({ sent: 0 });

  const [{ data: members, error: mErr }, { data: tokens, error: tErr }] = await Promise.all([
    admin.from("household_members").select("user_id, household_id").in("user_id", userIds),
    admin.from("push_tokens").select("token, user_id").in("user_id", userIds),
  ]);
  if (mErr || tErr) return json({ error: (mErr ?? tErr)!.message }, 500);

  const householdOf = new Map((members ?? []).map((m) => [m.user_id as string, m.household_id as string]));
  const householdIds = [...new Set(householdOf.values())];
  if (householdIds.length === 0) return json({ sent: 0 });

  const { data: rows, error: eErr } = await admin
    .from("expiring_products")
    .select("household_id, item_name, is_thawed, days_left")
    .in("household_id", householdIds);
  if (eErr) return json({ error: eErr.message }, 500);

  const byHousehold = new Map<string, ExpiringRow[]>();
  for (const r of (rows ?? []) as ExpiringRow[]) {
    byHousehold.set(r.household_id, [...(byHousehold.get(r.household_id) ?? []), r]);
  }

  const messages = (tokens ?? []).flatMap((t) => {
    const household = householdOf.get(t.user_id as string);
    const msg = household ? buildAlertMessage(byHousehold.get(household) ?? []) : null;
    return msg ? [{ to: t.token as string, sound: "default", title: msg.title, body: msg.body, data: { screen: "expiring" } }] : [];
  });

  // Expo Push API は1リクエスト100件まで
  let sent = 0;
  const invalidTokens: string[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      console.error("expo push failed", res.status, await res.text());
      continue;
    }
    const { data } = await res.json() as { data: { status: string; details?: { error?: string } }[] };
    data.forEach((ticket, j) => {
      if (ticket.status === "ok") sent++;
      else if (ticket.details?.error === "DeviceNotRegistered") invalidTokens.push(chunk[j].to);
    });
  }

  // アンインストールされた端末のトークンを削除
  if (invalidTokens.length > 0) {
    await admin.from("push_tokens").delete().in("token", invalidTokens);
  }

  return json({ hour: jstHour, sent, removedTokens: invalidTokens.length });
});
