// 使い切りアラート: pg_cron から毎時呼ばれ、通知時刻（日本時間）が来たユーザーの端末にプッシュ通知を送る
// 通知は世帯メンバー全員に送る（各自の notify_hour に届く）
// 送信先: ネイティブアプリ（Expo Push）と Web 版（Web Push・VAPID）
import { createClient } from "npm:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";
import { buildAlertMessage, type ExpiringRow } from "./message.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Alert = { title: string; body: string };

// ---------- ネイティブアプリ（Expo Push） ----------
async function sendExpo(targets: { token: string; msg: Alert }[]): Promise<{ sent: number; invalid: string[] }> {
  const messages = targets.map(({ token, msg }) => ({
    to: token, sound: "default", title: msg.title, body: msg.body, data: { screen: "expiring" },
  }));
  let sent = 0;
  const invalid: string[] = [];
  // Expo Push API は1リクエスト100件まで
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
      else if (ticket.details?.error === "DeviceNotRegistered") invalid.push(chunk[j]!.to);
    });
  }
  return { sent, invalid };
}

// ---------- Web 版（Web Push） ----------
type WebSub = { endpoint: string; p256dh: string; auth: string };

async function sendWebPush(targets: { sub: WebSub; msg: Alert }[]): Promise<{ sent: number; invalid: string[] }> {
  const vapidJson = Deno.env.get("VAPID_KEYS");
  if (targets.length === 0 || !vapidJson) return { sent: 0, invalid: [] };

  const vapidKeys = await webpush.importVapidKeys(JSON.parse(vapidJson), { extractable: false });
  const appServer = await webpush.ApplicationServer.new({
    contactInformation: Deno.env.get("VAPID_CONTACT") ?? "mailto:admin@example.com",
    vapidKeys,
  });

  let sent = 0;
  const invalid: string[] = [];
  await Promise.all(targets.map(async ({ sub, msg }) => {
    try {
      const subscriber = appServer.subscribe({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } });
      await subscriber.pushTextMessage(JSON.stringify({ ...msg, url: "/dashboard" }), { ttl: 6 * 3600 });
      sent++;
    } catch (e) {
      // 購読が解除された（410）・存在しない（404）ものは削除する
      if (e instanceof webpush.PushMessageError && (e.isGone() || e.response.status === 404)) invalid.push(sub.endpoint);
      else console.error("web push failed", sub.endpoint.slice(0, 60), e);
    }
  }));
  return { sent, invalid };
}

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

  const [members, tokens, webSubs] = await Promise.all([
    admin.from("household_members").select("user_id, household_id").in("user_id", userIds),
    admin.from("push_tokens").select("token, user_id").in("user_id", userIds),
    admin.from("web_push_subscriptions").select("endpoint, p256dh, auth, user_id").in("user_id", userIds),
  ]);
  const err = members.error ?? tokens.error ?? webSubs.error;
  if (err) return json({ error: err.message }, 500);

  const householdOf = new Map((members.data ?? []).map((m) => [m.user_id as string, m.household_id as string]));
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
  const messageFor = (userId: string): Alert | null => {
    const household = householdOf.get(userId);
    return household ? buildAlertMessage(byHousehold.get(household) ?? []) : null;
  };

  const expoTargets = (tokens.data ?? []).flatMap((t) => {
    const msg = messageFor(t.user_id as string);
    return msg ? [{ token: t.token as string, msg }] : [];
  });
  const webTargets = (webSubs.data ?? []).flatMap((s) => {
    const msg = messageFor(s.user_id as string);
    return msg ? [{ sub: s as WebSub, msg }] : [];
  });

  const [expo, web] = await Promise.all([sendExpo(expoTargets), sendWebPush(webTargets)]);

  // アンインストール・購読解除された端末を削除
  if (expo.invalid.length > 0) await admin.from("push_tokens").delete().in("token", expo.invalid);
  if (web.invalid.length > 0) await admin.from("web_push_subscriptions").delete().in("endpoint", web.invalid);

  return json({
    hour: jstHour,
    sent: expo.sent + web.sent,
    sentApp: expo.sent,
    sentWeb: web.sent,
    removed: expo.invalid.length + web.invalid.length,
  });
});
