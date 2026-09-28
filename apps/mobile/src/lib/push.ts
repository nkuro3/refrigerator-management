import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
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
