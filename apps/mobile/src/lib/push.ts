import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import { supabase } from "./supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

let registeredToken: string | null = null;

// 通知の許可を取り、Expo のプッシュトークンを DB に保存する
// シミュレーターや Expo Go（Android）では取得できないので何もしない
export async function registerPushToken(): Promise<void> {
  if (!Device.isDevice) return;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "使い切りアラート",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn("EAS の projectId がないためプッシュ通知を登録できません（eas init を実行してください）");
    return;
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    // 端末を別のユーザーが使い始めた場合も、RPC で持ち主を付け替える
    const { error } = await supabase.rpc("register_push_token", {
      p_token: token,
      p_platform: Platform.OS === "ios" ? "ios" : "android",
    });
    if (error) throw error;
    registeredToken = token;
  } catch (e) {
    console.warn("プッシュトークンの登録に失敗しました", e);
  }
}

// ログアウト前に呼び、この端末に前のユーザー宛の通知が届かないようにする
export async function unregisterPushToken(): Promise<void> {
  if (!registeredToken) return;
  await supabase.from("push_tokens").delete().eq("token", registeredToken);
  registeredToken = null;
}

// ---- Web 版（push.web.ts）と共通のインターフェース ----
// ネイティブアプリでは通知の許可はログイン後に自動で求めるので、設定画面での操作は不要
export type PushStatus = "unsupported" | "needs-install" | "default" | "granted" | "denied" | "native";

export async function getPushStatus(): Promise<PushStatus> {
  return "native";
}

export async function enablePush(): Promise<PushStatus> {
  await registerPushToken();
  return "native";
}

// 通知をタップしたら、通知の url の画面を開く（アプリ未起動時のタップも含む）
// 使い切りアラートはダッシュボード、冷蔵庫の更新通知は在庫一覧
export function useNotificationNavigation(ready: boolean): void {
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (ready && lastResponse) {
      const url = lastResponse.notification.request.content.data?.url;
      router.navigate(url === "/" ? "/" : "/dashboard");
      Notifications.clearLastNotificationResponse();
    }
  }, [ready, lastResponse]);
}
