// 使い切りアラート: pg_cron から毎時呼ばれ、通知時刻（日本時間）が来たユーザーの端末にプッシュ通知を送る
// 通知は世帯メンバー全員に送る（各自の notify_hour に届く）
import { createClient } from "npm:@supabase/supabase-js@2";
import { type Notice, notify } from "../_shared/push.ts";
import { buildAlertMessage, type ExpiringRow } from "./message.ts";

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
  if (userIds.length === 0) return json({ hour: jstHour, sent: 0 });

  const { data: members, error: mErr } = await admin
    .from("household_members").select("user_id, household_id").in("user_id", userIds);
  if (mErr) return json({ error: mErr.message }, 500);

  const householdOf = new Map((members ?? []).map((m) => [m.user_id as string, m.household_id as string]));
  const householdIds = [...new Set(householdOf.values())];
  if (householdIds.length === 0) return json({ hour: jstHour, sent: 0 });

  const { data: rows, error: eErr } = await admin
    .from("expiring_products")
    .select("household_id, item_name, is_thawed, days_left")
    .in("household_id", householdIds);
  if (eErr) return json({ error: eErr.message }, 500);

  const byHousehold = new Map<string, ExpiringRow[]>();
  for (const r of (rows ?? []) as ExpiringRow[]) {
    byHousehold.set(r.household_id, [...(byHousehold.get(r.household_id) ?? []), r]);
  }

  const notices: Notice[] = [];
  for (const [userId, household] of householdOf) {
    const alert = buildAlertMessage(byHousehold.get(household) ?? []);
    if (alert) notices.push({ userId, kind: "expiry", msg: { ...alert, url: "/dashboard", tag: "expiry-alert" }, push: true });
  }

  try {
    const r = await notify(admin, notices);
    return json({ hour: jstHour, sent: r.sentApp + r.sentWeb, ...r });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
