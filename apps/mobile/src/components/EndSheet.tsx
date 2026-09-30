import { DISCARD_REASON_LABELS, type DiscardReason, type ProductWithItem } from "@fridge/shared";
import { useState } from "react";
import { Modal, Pressable, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEndProduct } from "../lib/queries";
import { Button, Chip, colors, ErrorText, styles } from "./ui";

type Props = {
  product: ProductWithItem | null;
  isLastOfItem: boolean; // その品目の最後の1つかどうか（買い物リストへの追加の案内に使う）
  onClose: () => void;
  onDone?: () => void;
};

// 終了操作: 使い切った／捨てた と、買い物リストへの追加
export function EndSheet(props: Props) {
  if (!props.product) return null;
  // 商品ごとに状態を作り直す
  return <EndSheetContent key={props.product.id} {...props} product={props.product} />;
}

function EndSheetContent({ product, isLastOfItem, onClose, onDone }: Props & { product: ProductWithItem }) {
  const endProduct = useEndProduct();
  const [reason, setReason] = useState<"used_up" | "discarded">("used_up");
  const [discardReason, setDiscardReason] = useState<DiscardReason>("expired");
  // 買い物リストへの追加は最初はオフ（必要なときだけオンにする）
  const [addToShopping, setAddToShopping] = useState(false);

  const submit = () =>
    endProduct.mutate(
      { product, reason, discardReason, addToShopping },
      { onSuccess: () => { onClose(); onDone?.(); } }, // 失敗時は endProduct.error を表示する
    );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)" }} onPress={onClose} />
      <SafeAreaView style={{ backgroundColor: colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
        <View style={{ padding: 20, gap: 16 }}>
          <Text style={styles.title}>{product.name}</Text>
          <View style={styles.row}>
            <Chip label="使い切った" selected={reason === "used_up"} onPress={() => setReason("used_up")} />
            <Chip label="捨てた" selected={reason === "discarded"} onPress={() => setReason("discarded")} />
          </View>
          {reason === "discarded" && (
            <View style={{ gap: 8 }}>
              <Text style={styles.label}>理由</Text>
              <View style={styles.row}>
                {(Object.keys(DISCARD_REASON_LABELS) as DiscardReason[]).map((r) => (
                  <Chip key={r} label={DISCARD_REASON_LABELS[r]} selected={discardReason === r} onPress={() => setDiscardReason(r)} />
                ))}
              </View>
            </View>
          )}
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.body}>買い物リストに「{product.item_masters.name}」を追加</Text>
              {isLastOfItem && <Text style={styles.muted}>在庫はこれが最後の1つです</Text>}
            </View>
            <Switch value={addToShopping} onValueChange={setAddToShopping} trackColor={{ true: colors.primary }} />
          </View>
          <ErrorText error={endProduct.error} />
          <Button title="記録する" loading={endProduct.isPending} onPress={submit} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}
