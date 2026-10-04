import Ionicons from "@expo/vector-icons/Ionicons";
import { router, Tabs } from "expo-router";
import { type ColorValue, Pressable, View } from "react-native";
import { NotificationBell } from "../../components/NotificationBell";
import { colors } from "../../components/ui";

type IconName = keyof typeof Ionicons.glyphMap;
function icon(name: IconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
        headerRight: () => <NotificationBell />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "在庫",
          tabBarIcon: icon("file-tray-stacked-outline"),
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 4 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="まとめて登録"
                onPress={() => router.push("/register")}
                style={{ paddingHorizontal: 12 }}
              >
                <Ionicons name="camera-outline" size={26} color={colors.primary} />
              </Pressable>
              <NotificationBell />
            </View>
          ),
        }}
      />
      <Tabs.Screen name="shopping" options={{ title: "買い物", tabBarIcon: icon("cart-outline") }} />
      <Tabs.Screen name="dashboard" options={{ title: "ダッシュボード", tabBarIcon: icon("stats-chart-outline") }} />
      <Tabs.Screen name="settings" options={{ title: "設定", tabBarIcon: icon("settings-outline") }} />
    </Tabs>
  );
}
