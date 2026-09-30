import { Alert, Platform } from "react-native";

// 確認ダイアログ。Web では react-native の Alert が表示されないので window.confirm を使う
export function confirmAction(title: string, confirmLabel: string, onConfirm: () => void): void {
  if (Platform.OS === "web") {
    if (window.confirm(title)) onConfirm();
    return;
  }
  Alert.alert(title, undefined, [
    { text: "キャンセル", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}
