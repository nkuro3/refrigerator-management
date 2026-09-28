import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { colors, Loading } from "../components/ui";
import { AuthProvider, useAuth } from "../lib/auth";
import { draftStore } from "../lib/draft-store";
import { registerPushToken } from "../lib/push";
import { useRealtimeSync } from "../lib/queries";

function RootNavigator() {
  const { loading, session, household } = useAuth();
  const userId = session?.user.id;

  const queryClient = useQueryClient();
  const signedIn = !!session;
  const ready = signedIn && !!household;

  useRealtimeSync(household?.id);

  // ユーザーが変わったら前のユーザーのキャッシュと登録途中のデータを捨てる
  useEffect(() => {
    queryClient.clear();
    draftStore.set(null);
  }, [userId, queryClient]);

  useEffect(() => {
    if (ready) void registerPushToken();
  }, [ready, userId]);

  // 使い切りアラートの通知をタップしたらダッシュボードを開く（アプリ未起動時のタップも含む）
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (ready && lastResponse) {
      router.navigate("/dashboard");
      Notifications.clearLastNotificationResponse();
    }
  }, [ready, lastResponse]);

  if (loading) return <Loading />;

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ title: "ログイン" }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !household}>
        <Stack.Screen name="onboarding" options={{ title: "世帯の設定" }} />
      </Stack.Protected>
      <Stack.Protected guard={ready}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="item/[id]" options={{ title: "品目" }} />
        <Stack.Screen name="product/[id]" options={{ title: "商品" }} />
        <Stack.Screen name="register/index" options={{ title: "まとめて登録" }} />
        <Stack.Screen name="register/confirm" options={{ title: "登録内容の確認" }} />
        <Stack.Screen name="register/manual" options={{ title: "手入力で登録" }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </QueryClientProvider>
  );
}
