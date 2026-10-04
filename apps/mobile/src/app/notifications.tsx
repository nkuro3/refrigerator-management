import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { colors, Empty, ErrorText, Loading, styles } from "../components/ui";
import { type AppNotification, useMarkNotificationsRead, useNotifications } from "../lib/queries";

// 「たった今」「5分前」「3時間前」「昨日 8:00」「10/2 8:00」
function when(iso: string, now = Date.now()): string {
  const t = new Date(iso);
  const min = Math.floor((now - t.getTime()) / 60_000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  if (min < 6 * 60) return `${Math.floor(min / 60)}時間前`;
  const hm = `${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(t)) / 86_400_000);
  if (days === 0) return `今日 ${hm}`;
  if (days === 1) return `昨日 ${hm}`;
  return `${t.getMonth() + 1}/${t.getDate()} ${hm}`;
}

const ICONS = { expiry: "alarm-outline", change: "people-outline" } as const;

// お知らせ一覧: プッシュ通知と同じ内容（使い切りアラート・家族による冷蔵庫の更新）。開いたら既読にする
export default function Notifications() {
  const { data, isLoading, error } = useNotifications();
  if (isLoading) return <Loading />;
  return <NotificationList data={data ?? []} error={error} />;
}

function NotificationList({ data, error }: { data: AppNotification[]; error: unknown }) {
  const { mutate: markRead } = useMarkNotificationsRead();
  // 開いた時点で未読だったものは、既読にしたあとも色を付けたままにする
  const [unreadIds] = useState(() => new Set(data.filter((n) => !n.read_at).map((n) => n.id)));
  const hasUnread = data.some((n) => !n.read_at);

  useEffect(() => {
    if (hasUnread) markRead();
  }, [hasUnread, markRead]);

  const renderItem = ({ item }: { item: AppNotification }) => {
    const isNew = unreadIds.has(item.id) || !item.read_at;
    return (
      <Pressable
        onPress={() => router.navigate(item.url === "/dashboard" ? "/dashboard" : "/")}
        accessibilityRole="button"
        style={{
          flexDirection: "row",
          gap: 12,
          padding: 16,
          backgroundColor: isNew ? colors.soft : colors.card,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Ionicons name={ICONS[item.kind]} size={22} color={item.kind === "expiry" ? colors.warn : colors.primary} />
        <View style={{ flex: 1, gap: 4 }}>
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <Text style={[styles.body, { fontWeight: "700", flex: 1 }]}>{item.title}</Text>
            <Text style={styles.muted}>{when(item.created_at)}</Text>
          </View>
          <Text style={styles.body}>{item.body}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <ErrorText error={error} />
      <FlatList
        data={data}
        keyExtractor={(n) => String(n.id)}
        renderItem={renderItem}
        ListEmptyComponent={<Empty title="お知らせはまだありません" />}
        ListFooterComponent={data.length > 0 ? <Text style={[styles.muted, { padding: 16, textAlign: "center" }]}>30日より前のお知らせは自動で消えます</Text> : null}
      />
    </View>
  );
}
