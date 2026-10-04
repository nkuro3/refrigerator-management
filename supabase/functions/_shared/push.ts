// プッシュ通知の送信（使い切りアラートと冷蔵庫の更新通知で共通）
// 送信先: ネイティブアプリ（Expo Push）と Web 版（Web Push・VAPID）
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// url: 通知をタップしたときに開く画面。tag: 同じ tag の通知は端末で上書きされる（Web 版）
export type PushMessage = { title: string; body: string; url: string; tag: string };

// ---------- ネイティブアプリ（Expo Push） ----------
async function sendExpo(targets: { token: string; msg: PushMessage }[]): Promise<{ sent: number; invalid: string[] }> {
  const messages = targets.map(({ token, msg }) => ({
    to: token, sound: "default", title: msg.title, body: msg.body, data: { url: msg.url },
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

async function sendWebPush(targets: { sub: WebSub; msg: PushMessage }[]): Promise<{ sent: number; invalid: string[] }> {
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
      await subscriber.pushTextMessage(JSON.stringify(msg), { ttl: 6 * 3600 });
      sent++;
    } catch (e) {
      // 購読が解除された（410）・存在しない（404）ものは削除する
      if (e instanceof webpush.PushMessageError && (e.isGone() || e.response.status === 404)) invalid.push(sub.endpoint);
      else console.error("web push failed", sub.endpoint.slice(0, 60), e);
    }
  }));
  return { sent, invalid };
}

// ユーザーごとのメッセージを、そのユーザーの全端末に送る。無効になった端末は削除する
export async function sendToUsers(
  admin: SupabaseClient,
  messages: Map<string, PushMessage[]>, // user_id → 送るメッセージ
): Promise<{ sentApp: number; sentWeb: number; removed: number }> {
  const userIds = [...messages.keys()];
  if (userIds.length === 0) return { sentApp: 0, sentWeb: 0, removed: 0 };

  const [tokens, webSubs] = await Promise.all([
    admin.from("push_tokens").select("token, user_id").in("user_id", userIds),
    admin.from("web_push_subscriptions").select("endpoint, p256dh, auth, user_id").in("user_id", userIds),
  ]);
  const err = tokens.error ?? webSubs.error;
  if (err) throw new Error(err.message);

  const expoTargets = (tokens.data ?? []).flatMap((t) =>
    (messages.get(t.user_id as string) ?? []).map((msg) => ({ token: t.token as string, msg }))
  );
  const webTargets = (webSubs.data ?? []).flatMap((s) =>
    (messages.get(s.user_id as string) ?? []).map((msg) => ({ sub: s as WebSub, msg }))
  );

  const [expo, web] = await Promise.all([sendExpo(expoTargets), sendWebPush(webTargets)]);

  // アンインストール・購読解除された端末を削除
  const expoInvalid = [...new Set(expo.invalid)];
  const webInvalid = [...new Set(web.invalid)];
  if (expoInvalid.length > 0) await admin.from("push_tokens").delete().in("token", expoInvalid);
  if (webInvalid.length > 0) await admin.from("web_push_subscriptions").delete().in("endpoint", webInvalid);

  return { sentApp: expo.sent, sentWeb: web.sent, removed: expoInvalid.length + webInvalid.length };
}

// お知らせに保存してからプッシュ通知を送る
// push: false のものはお知らせ（アプリのベル）にだけ載せる
export type Notice = { userId: string; kind: "expiry" | "change"; msg: PushMessage; push: boolean };

export async function notify(
  admin: SupabaseClient,
  notices: Notice[],
): Promise<{ saved: number; sentApp: number; sentWeb: number; removed: number }> {
  if (notices.length === 0) return { saved: 0, sentApp: 0, sentWeb: 0, removed: 0 };

  const { error } = await admin.from("notifications").insert(notices.map((n) => ({
    user_id: n.userId, kind: n.kind, title: n.msg.title, body: n.msg.body, url: n.msg.url,
  })));
  if (error) console.error("save notifications failed", error.message); // 保存に失敗してもプッシュは送る

  const messages = new Map<string, PushMessage[]>();
  for (const n of notices) {
    if (!n.push) continue;
    messages.set(n.userId, [...(messages.get(n.userId) ?? []), n.msg]);
  }
  const r = await sendToUsers(admin, messages);
  return { saved: error ? 0 : notices.length, ...r };
}
