import {
  buildRegisterPayload,
  categoryName,
  type DraftItem,
  needsReview,
} from "@fridge/shared";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { ItemPicker } from "../../components/ItemPicker";
import { Button, Card, Chip, colors, Empty, ErrorText, Field, Screen, styles } from "../../components/ui";
import { draftStore, useRegisterDraft } from "../../lib/draft-store";
import { removePhotos } from "../../lib/images";
import { useItemMasters, useRegisterPurchase } from "../../lib/queries";

const SOURCE_LABELS = { receipt_only: "レシートのみ", photo_only: "写真のみ", both: "" } as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// まとめ登録の2ステップ目: AIの判定結果を品目ごとに確認・修正して登録する
export default function RegisterConfirm() {
  const draft = useRegisterDraft();
  const { data: masters = [] } = useItemMasters();
  const register = useRegisterPurchase();
  const [pickingKey, setPickingKey] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  if (!draft) {
    return (
      <Empty title="登録中のデータがありません">
        <Button title="撮影からやり直す" onPress={() => router.replace("/register")} />
      </Empty>
    );
  }

  const setItem = (key: string, patch: Partial<DraftItem>) =>
    draftStore.update((d) => ({ ...d, items: d.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) }));

  const itemLabel = (d: DraftItem) => {
    if (d.itemMasterId) {
      const m = masters.find((x) => x.id === d.itemMasterId);
      return m ? m.name : "（品目）";
    }
    return d.newItem ? `${d.newItem.name}（新しい品目）` : "品目を選択";
  };

  // 品目ごとにまとめて表示する
  const groups = new Map<string, DraftItem[]>();
  for (const d of draft.items) {
    const label = d.itemMasterId ? itemLabel(d) : `new:${d.newItem?.name ?? d.key}`;
    groups.set(label, [...(groups.get(label) ?? []), d]);
  }
  const includedCount = draft.items.filter((d) => d.include).reduce((n, d) => n + d.quantity, 0);

  const submit = async () => {
    setError(null);
    try {
      if (!DATE_RE.test(draft.purchasedOn)) throw new Error("購入日は YYYY-MM-DD の形で入力してください");
      const payload = buildRegisterPayload(draft.items, {
        purchasedOn: draft.purchasedOn,
        receiptPath: null, // レシート画像は保存しない（登録後に削除する）
        photoPaths: draft.photoPaths,
      });
      await register.mutateAsync(payload);
      if (draft.receiptPath) await removePhotos([draft.receiptPath]);
      draftStore.set(null);
      router.dismissAll();
      router.replace("/");
    } catch (e) {
      setError(e);
    }
  };

  const cancel = async () => {
    await removePhotos([draft.receiptPath, ...draft.photoPaths].filter((p): p is string => !!p));
    draftStore.set(null);
    router.back();
  };

  const picking = draft.items.find((d) => d.key === pickingKey);

  return (
    <Screen>
      <Field label="購入日" value={draft.purchasedOn} onChangeText={(v) => draftStore.update((d) => ({ ...d, purchasedOn: v }))} keyboardType="numbers-and-punctuation" />
      <Text style={styles.muted}>黄色の行は確認してください。登録しないものはスイッチをオフにします。</Text>

      {[...groups.entries()].map(([label, rows]) => (
        <Card key={label}>
          {rows.map((d) => {
            const review = needsReview(d);
            const newItem = d.newItem;
            return (
              <View
                key={d.key}
                style={{
                  gap: 8,
                  padding: 10,
                  borderRadius: 10,
                  backgroundColor: review && d.include ? colors.warnSoft : "transparent",
                  opacity: d.include ? 1 : 0.5,
                }}
              >
                <View style={[styles.row, { justifyContent: "space-between" }]}>
                  <Pressable onPress={() => setPickingKey(d.key)} accessibilityRole="button" style={{ flex: 1 }}>
                    <Text style={[styles.body, { fontWeight: "700", color: colors.primary }]}>{itemLabel(d)} ›</Text>
                  </Pressable>
                  <Switch value={d.include} onValueChange={(v) => setItem(d.key, { include: v })} trackColor={{ true: colors.primary }} />
                </View>
                <View style={styles.wrap}>
                  {SOURCE_LABELS[d.source] ? <Chip label={SOURCE_LABELS[d.source]} tone="warn" /> : null}
                  {d.confidence === "low" && <Chip label="自信なし" tone="warn" />}
                  {newItem && <Chip label={`新しい品目：${categoryName(newItem.categoryId)}・${newItem.shelfDays}日`} tone="info" />}
                  {d.receiptText && <Text style={styles.muted}>レシート：{d.receiptText}</Text>}
                </View>
                <TextInput
                  value={d.name}
                  onChangeText={(v) => setItem(d.key, { name: v })}
                  style={styles.input}
                  accessibilityLabel="商品名"
                />
                <View style={styles.row}>
                  <Text style={[styles.label, { width: 36 }]}>個数</Text>
                  <Button title="−" variant="secondary" small onPress={() => setItem(d.key, { quantity: Math.max(1, d.quantity - 1) })} />
                  <Text style={[styles.body, { minWidth: 24, textAlign: "center" }]}>{d.quantity}</Text>
                  <Button title="＋" variant="secondary" small onPress={() => setItem(d.key, { quantity: Math.min(50, d.quantity + 1) })} />
                </View>
                {/* 単価は別の行にする（Web では入力欄が既定の幅から縮まず、1行に並べるとはみ出すため） */}
                <View style={styles.row}>
                  <Text style={[styles.label, { width: 36 }]}>単価</Text>
                  <TextInput
                    value={d.unitPrice === null ? "" : String(d.unitPrice)}
                    onChangeText={(v) => setItem(d.key, { unitPrice: v.trim() === "" ? null : Number(v.replace(/\D/g, "")) || 0 })}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    placeholder="未入力"
                    placeholderTextColor={colors.sub}
                    style={[styles.input, { width: 120, minWidth: 0, textAlign: "right" }]}
                    accessibilityLabel="単価（円）"
                  />
                  <Text style={styles.body}>円</Text>
                </View>
                <View style={[styles.row, { justifyContent: "space-between" }]}>
                  <Text style={styles.body}>冷凍食品</Text>
                  <Switch value={d.isFrozen} onValueChange={(v) => setItem(d.key, { isFrozen: v })} trackColor={{ true: colors.primary }} />
                </View>
              </View>
            );
          })}
        </Card>
      ))}

      <ErrorText error={error ?? register.error} />
      <Button title={`${includedCount}点を登録する`} loading={register.isPending} disabled={includedCount === 0} onPress={submit} />
      <Button title="登録をやめる" variant="ghost" onPress={cancel} />
      {draft.model ? <Text style={[styles.muted, { textAlign: "center" }]}>判定: {draft.model}</Text> : null}

      <ItemPicker
        visible={!!picking}
        initialQuery={picking?.newItem?.name ?? ""}
        onClose={() => setPickingKey(null)}
        onSelect={(item) => {
          if (pickingKey) setItem(pickingKey, { itemMasterId: item.id, newItem: null });
          setPickingKey(null);
        }}
      />
    </Screen>
  );
}
