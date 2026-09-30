// Web 版（PWA）のプッシュ通知: Service Worker（public/sw.js）と Web Push
// Metro は Web では push.ts より先にこのファイルを使う。公開する関数は push.ts と同じにすること
//
// iPhone では「ホーム画面に追加」したアプリの中でしか通知を受け取れず、
// 許可のダイアログもボタン操作から開く必要がある（自動では開かない）
import { supabase } from "./supabase";

export type PushStatus = "unsupported" | "needs-install" | "default" | "granted" | "denied" | "native";

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? "";

let registeredEndpoint: string | null = null;

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  let binary = "";
  new Uint8Array(buffer).forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function getPushStatus(): Promise<PushStatus> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return "unsupported";
  if (isIOS() && !isStandalone()) return "needs-install";
  if (!("PushManager" in window) || !("Notification" in window) || !VAPID_PUBLIC_KEY) return "unsupported";
  return Notification.permission === "granted" ? "granted" : Notification.permission === "denied" ? "denied" : "default";
}

async function subscribeAndSave(): Promise<void> {
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY),
    }));
  const { error } = await supabase.rpc("register_web_push", {
    p_endpoint: subscription.endpoint,
    p_p256dh: bytesToBase64Url(subscription.getKey("p256dh")),
    p_auth: bytesToBase64Url(subscription.getKey("auth")),
  });
  if (error) throw error;
  registeredEndpoint = subscription.endpoint;
}

// ログイン後に呼ばれる。すでに許可済みなら購読を保存し直す（許可のダイアログは開かない）
export async function registerPushToken(): Promise<void> {
  try {
    if ((await getPushStatus()) === "granted") await subscribeAndSave();
  } catch (e) {
    console.warn("プッシュ通知の登録に失敗しました", e);
  }
}

// 設定画面のボタンから呼ぶ（iPhone ではボタン操作から許可を求める必要がある）
export async function enablePush(): Promise<PushStatus> {
  const status = await getPushStatus();
  if (status !== "default" && status !== "granted") return status;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "default";
  await subscribeAndSave();
  return "granted";
}

// ログアウト前に呼び、このブラウザに前のユーザー宛の通知が届かないようにする
export async function unregisterPushToken(): Promise<void> {
  if (!registeredEndpoint) return;
  await supabase.from("web_push_subscriptions").delete().eq("endpoint", registeredEndpoint);
  registeredEndpoint = null;
}

// 通知をタップしたときの画面遷移は Service Worker（sw.js の notificationclick）で行う
export function useNotificationNavigation(_ready: boolean): void {}
