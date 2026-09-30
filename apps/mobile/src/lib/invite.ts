// 招待リンク: 設定画面から「URL＋招待コード」を送り、リンクから開いたら招待コードを自動で入力する
// リンクの形: https://<Web 版のアドレス>/?invite=K7MQ2XWP
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const STORAGE_KEY = "pendingInviteCode";
const CODE_RE = /^[A-Z0-9]{8}$/;

// Web 版の公開アドレス。Web では開いているアドレスを使い、アプリ版では .env の値を使う
export function webAppUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return (process.env.EXPO_PUBLIC_WEB_URL ?? "https://fridge-app-eem.pages.dev").replace(/\/$/, "");
}

export function inviteUrl(code: string): string {
  return `${webAppUrl()}/?invite=${encodeURIComponent(code)}`;
}

export function inviteMessage(code: string): string {
  return [
    "冷蔵庫アプリに招待します。",
    "下のリンクを開いてアカウントを作成すると、招待コードが自動で入力されます。",
    inviteUrl(code),
    "",
    `招待コード: ${code}（7日間有効）`,
    "iPhone の方は、Safari で開いて共有ボタンから「ホーム画面に追加」すると、アプリのように使えて通知も届きます。",
  ].join("\n");
}

function normalize(value: string | null | undefined): string | null {
  const code = (value ?? "").trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

// Web: ルーターがログイン画面へ移動して URL が書き換わる前に、読み込み時点の URL から取り出して保存する
let captured: string | null = null;
if (Platform.OS === "web" && typeof window !== "undefined") {
  captured = normalize(new URLSearchParams(window.location.search).get("invite"));
  if (captured) {
    void AsyncStorage.setItem(STORAGE_KEY, captured).catch(() => {});
    // アドレスバーからは消しておく（ホーム画面に追加したときに残らないように）
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
}

export async function getPendingInviteCode(): Promise<string | null> {
  if (captured) return captured;
  try {
    return normalize(await AsyncStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export async function clearPendingInviteCode(): Promise<void> {
  captured = null;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // 保存できない環境では何もしない
  }
}
