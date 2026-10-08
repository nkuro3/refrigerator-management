import {
  categoryName,
  DISCARD_REASON_LABELS,
  END_REASON_LABELS,
  expiryStatus,
  FREEZE_LABELS,
  type FreezeState,
  type Product,
  REMAINING_LABELS,
  REMAINING_ORDER,
  todayJst,
} from "@fridge/shared";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { DateField, formatDateLabel } from "../../components/DateField";
import { EndSheet } from "../../components/EndSheet";
import { ItemPicker } from "../../components/ItemPicker";
import { expiryTone } from "../../components/ProductRow";
import { Button, Card, Chip, ErrorText, Loading, Screen, SectionTitle, styles } from "../../components/ui";
import { signedUrls } from "../../lib/images";
import { useActiveProducts, useProduct, useUndoEnd, useUpdateProduct } from "../../lib/queries";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: product, isLoading, refetch } = useProduct(id);
  const { data: active = [] } = useActiveProducts();
  const update = useUpdateProduct();
  const undoEnd = useUndoEnd();
  const [ending, setEnding] = useState(false);
  const [picking, setPicking] = useState(false);
  const [editingExpiry, setEditingExpiry] = useState(false);
  const [expiryInput, setExpiryInput] = useState("");
  const today = todayJst();

  const imagePath = product?.image_path ?? null;
  const { data: urls } = useQuery({
    queryKey: ["signed", imagePath],
    enabled: !!imagePath,
    staleTime: 30 * 60_000,
    queryFn: () => signedUrls([imagePath!]),
  });

  if (isLoading || !product) return <Loading />;

  // 失敗時は update.error を表示する
  const patch = async (p: Partial<Product>): Promise<boolean> => {
    try {
      await update.mutateAsync({ id: product.id, patch: p });
      await refetch();
      return true;
    } catch {
      return false;
    }
  };
  const status = expiryStatus(product, today);
  const ended = product.ended_at !== null;
  const sameItemCount = active.filter((p) => p.item_master_id === product.item_master_id).length;
  const freezeOptions: FreezeState[] = product.freeze_state === "none" ? ["none", "frozen"] : ["none", "frozen", "thawed"];

  return (
    <Screen>
      {imagePath && urls?.[imagePath] && (
        <Image source={{ uri: urls[imagePath] }} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 12 }} contentFit="cover" />
      )}

      <Card>
        <Text style={styles.title}>{product.name}</Text>
        <Text style={styles.muted}>
          {product.item_masters.name}（{categoryName(product.item_masters.category_id)}）・{product.purchased_on} 購入
          {product.price !== null ? `・${product.price.toLocaleString()}円` : ""}
        </Text>
        {!ended && <View style={styles.row}><Chip label={status.label} tone={expiryTone(status.kind)} /></View>}
        {!ended && <Button title="品目を変更" variant="ghost" small onPress={() => setPicking(true)} />}
      </Card>

      {ended ? (
        <Card>
          <SectionTitle>
            {END_REASON_LABELS[product.end_reason!]}
            {product.discard_reason ? `（${DISCARD_REASON_LABELS[product.discard_reason]}）` : ""}
          </SectionTitle>
          <Text style={styles.muted}>{new Date(product.ended_at!).toLocaleString("ja-JP")}</Text>
          <ErrorText error={undoEnd.error} />
          <Button title="取り消して在庫に戻す" variant="secondary" loading={undoEnd.isPending} onPress={() => undoEnd.mutate(product.id, { onSuccess: () => void refetch() })} />
        </Card>
      ) : (
        <>
          <Card>
            <SectionTitle>残量</SectionTitle>
            <View style={styles.wrap}>
              {REMAINING_ORDER.map((r) => (
                <Chip key={r} label={REMAINING_LABELS[r]} selected={product.remaining === r} onPress={() => patch({ remaining: r })} />
              ))}
            </View>
          </Card>

          <Card>
            <SectionTitle>冷凍</SectionTitle>
            <View style={styles.wrap}>
              {freezeOptions.map((f) => (
                <Chip key={f} label={FREEZE_LABELS[f]} selected={product.freeze_state === f} onPress={() => patch({ freeze_state: f })} />
              ))}
            </View>
            <Text style={styles.muted}>
              {product.freeze_state === "thawed"
                ? "解凍済みは期限を推定せず、使い切りアラートに毎日表示します。"
                : "冷凍すると、冷凍した日から冷凍の日持ちで期限を推定し直します。"}
            </Text>
          </Card>

          {product.freeze_state !== "thawed" && (
            <Card>
              <SectionTitle>期限</SectionTitle>
              <Text style={styles.body}>
                {product.expires_on ? formatDateLabel(product.expires_on) : "未設定"}
                {product.expires_is_estimated ? "（推定）" : ""}
              </Text>
              {editingExpiry ? (
                <>
                  <DateField label="印字の期限" value={expiryInput} onChange={setExpiryInput} />
                  <View style={styles.row}>
                    <Button
                      title="保存"
                      small
                      disabled={!DATE_RE.test(expiryInput)}
                      onPress={async () => {
                        if (await patch({ expires_on: expiryInput, expires_is_estimated: false })) setEditingExpiry(false);
                      }}
                    />
                    <Button title="やめる" variant="ghost" small onPress={() => setEditingExpiry(false)} />
                  </View>
                </>
              ) : (
                <Button
                  title="印字の期限に修正"
                  variant="ghost"
                  small
                  onPress={() => { setExpiryInput(product.expires_on ?? today); setEditingExpiry(true); }}
                />
              )}
            </Card>
          )}

          <ErrorText error={update.error} />
          <Button title="使い切った／捨てた" onPress={() => setEnding(true)} />
        </>
      )}

      <EndSheet
        product={ending ? product : null}
        isLastOfItem={sameItemCount <= 1}
        onClose={() => setEnding(false)}
        onDone={() => router.back()}
      />
      <ItemPicker
        visible={picking}
        onClose={() => setPicking(false)}
        onSelect={async (item) => {
          setPicking(false);
          await patch({ item_master_id: item.id });
        }}
      />
    </Screen>
  );
}
