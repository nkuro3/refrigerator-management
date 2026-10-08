import { Text, View } from "react-native";
import { colors, styles } from "./ui";

// 日付の入力（Web 版・PWA）。ブラウザの日付ピッカー（<input type="date">）を使う
// iPhone の Safari ではタップするとカレンダーが開く。公開する形は DateField.tsx と揃える
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

export function formatDateLabel(value: string): string {
  const d = toDate(value);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${"日月火水木金土"[d.getDay()]}）`;
}

export function DateField({ label, value, onChange, maximumDate }: DateFieldProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <input
        type="date"
        aria-label={label}
        value={value}
        max={maximumDate}
        required
        // 空にされた（クリアボタン）ときは元の値のままにする
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          boxSizing: "border-box",
          width: "100%",
          minHeight: 48,
          padding: "12px 14px",
          fontSize: 16, // 16px 未満だと iPhone で入力時に拡大される
          fontFamily: "-apple-system, BlinkMacSystemFont, \"Hiragino Sans\", \"Noto Sans JP\", system-ui, sans-serif",
          color: colors.text,
          backgroundColor: colors.card,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          textAlign: "left",
        }}
      />
    </View>
  );
}
