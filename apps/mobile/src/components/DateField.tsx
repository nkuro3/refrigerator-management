import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Platform, Pressable, Text, View } from "react-native";
import { colors, styles } from "./ui";

// 日付の入力（カレンダーから選ぶ）。値は "YYYY-MM-DD"
// ネイティブアプリ用。Web 版（PWA）は DateField.web.tsx（ブラウザの日付ピッカー）。公開する形は揃える
export type DateFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maximumDate?: string; // "YYYY-MM-DD"
};

export function toDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : new Date();
}

export function fromDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// 表示用: 2026-10-09 → 2026年10月9日（金）
export function formatDateLabel(value: string): string {
  const d = toDate(value);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${"日月火水木金土"[d.getDay()]}）`;
}

export function DateField({ label, value, onChange, maximumDate }: DateFieldProps) {
  const max = maximumDate ? toDate(maximumDate) : undefined;
  const handle = (e: DateTimePickerEvent, date?: Date) => {
    if (e.type === "set" && date) onChange(fromDate(date));
  };

  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      {Platform.OS === "ios" ? (
        // iOS: タップするとカレンダーが開くコンパクト表示
        <View style={{ alignItems: "flex-start" }}>
          <DateTimePicker value={toDate(value)} mode="date" display="compact" locale="ja-JP" maximumDate={max} onChange={handle} accentColor={colors.primary} />
        </View>
      ) : (
        // Android: タップでカレンダーのダイアログを開く
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}：${formatDateLabel(value)}`}
          onPress={() => DateTimePickerAndroid.open({ value: toDate(value), mode: "date", maximumDate: max, onChange: handle })}
          style={[styles.input, { justifyContent: "center" }]}
        >
          <Text style={styles.body}>{formatDateLabel(value)}</Text>
        </Pressable>
      )}
    </View>
  );
}
