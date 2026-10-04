import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useAuth } from "../lib/auth";
import { useUnreadCount } from "../lib/queries";
import { colors } from "./ui";

// ヘッダーのベル。未読のお知らせがあれば件数を出す
export function NotificationBell() {
  const { session } = useAuth();
  const { data: unread = 0 } = useUnreadCount(!!session);
  const label = unread > 0 ? `お知らせ（未読${unread}件）` : "お知らせ";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push("/notifications")}
      hitSlop={8}
      style={{ paddingHorizontal: 12 }}
    >
      <Ionicons name={unread > 0 ? "notifications" : "notifications-outline"} size={24} color={colors.primary} />
      {unread > 0 && (
        <View
          style={{
            position: "absolute",
            top: -4,
            right: 4,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            paddingHorizontal: 4,
            backgroundColor: colors.danger,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}
