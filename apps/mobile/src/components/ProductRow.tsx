import {
  categoryName,
  expiryStatus,
  type ExpiryKind,
  FREEZE_LABELS,
  type ProductWithItem,
  REMAINING_LABELS,
} from "@fridge/shared";
import { Pressable, Text, View } from "react-native";
import { Chip, colors, styles } from "./ui";

export function expiryTone(kind: ExpiryKind): "warn" | "danger" | "info" | undefined {
  if (kind === "expired") return "danger";
  if (kind === "soon" || kind === "thawed") return "warn";
  if (kind === "frozen") return "info";
  return undefined;
}

type Props = {
  product: ProductWithItem;
  today: string;
  count?: number; // 同じ商品をまとめたときの個数
  showItemName?: boolean;
  onPress: () => void;
};

export function ProductRow({ product, today, count = 1, showItemName = true, onPress }: Props) {
  const status = expiryStatus(product, today);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: pressed ? colors.soft : colors.card,
        borderBottomWidth: 1,
        borderColor: colors.border,
        gap: 6,
      })}
    >
      <View style={[styles.row, { justifyContent: "space-between" }]}>
        <Text style={[styles.body, { flex: 1, fontWeight: "600" }]} numberOfLines={1}>
          {product.name}
          {count > 1 ? `  ×${count}` : ""}
        </Text>
        <Chip label={status.label} tone={expiryTone(status.kind)} />
      </View>
      <Text style={styles.muted}>
        {showItemName ? `${product.item_masters.name}（${categoryName(product.item_masters.category_id)}）・` : ""}
        {REMAINING_LABELS[product.remaining]}
        {product.freeze_state !== "none" ? `・${FREEZE_LABELS[product.freeze_state]}` : ""}
      </Text>
    </Pressable>
  );
}
