import { CATEGORY_NAMES, type ItemMaster } from "@fridge/shared";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, Chip, ErrorText, Field, Loading, Screen, SectionTitle, styles } from "../../components/ui";
import { useHousehold } from "../../lib/auth";
import { confirmAction } from "../../lib/confirm";
import { useCreateItemMaster, useDeleteItemMaster, useItemMasters, useUpdateItemMaster } from "../../lib/queries";

const toAliases = (text: string) =>
  [...new Set(text.split(/[、,，\n]/).map((a) => a.trim()).filter(Boolean))];

const toDays = (text: string, fallback: number | null) => {
  const n = Math.round(Number(text.replace(/[^\d]/g, "")));
  return text.trim() === "" || !Number.isFinite(n) || n <= 0 ? fallback : Math.min(n, 3650);
};

// 品目の追加・編集（id = "new" で追加）
export default function ItemEdit() {
  const { id, name: initialName } = useLocalSearchParams<{ id: string; name?: string }>();
  const household = useHousehold();
  const { data: items = [], isLoading } = useItemMasters();
  const isNew = id === "new";
  const item = items.find((i) => i.id === id);

  if (isLoading) return <Loading />;
  if (!isNew && !item) return <Loading />;
  // 画面を開いた時点の値で入力欄を初期化する（key で作り直す）
  return <ItemForm key={id} isNew={isNew} householdId={household.id} initialName={initialName ?? ""} item={item} />;
}

function ItemForm({ isNew, householdId, initialName, item }: {
  isNew: boolean;
  householdId: string;
  initialName: string;
  item: ItemMaster | undefined;
}) {
  const create = useCreateItemMaster();
  const update = useUpdateItemMaster();
  const remove = useDeleteItemMaster();
  const [name, setName] = useState(item?.name ?? initialName);
  const [categoryId, setCategoryId] = useState<number>(item?.category_id ?? CATEGORY_NAMES.length);
  const [shelfDays, setShelfDays] = useState(String(item?.shelf_days ?? 7));
  const [frozenDays, setFrozenDays] = useState(item ? (item.frozen_shelf_days?.toString() ?? "") : "30");
  const [aliases, setAliases] = useState(item?.aliases.join("、") ?? "");

  const readOnly = !isNew && item?.household_id === null;
  const error = create.error ?? update.error ?? remove.error;
  const busy = create.isPending || update.isPending;

  const save = () => {
    const input = {
      name: name.trim(),
      categoryId,
      shelfDays: toDays(shelfDays, 7)!,
      frozenShelfDays: toDays(frozenDays, null),
      aliases: toAliases(aliases),
    };
    const done = { onSuccess: () => router.back() };
    if (isNew) create.mutate({ ...input, householdId }, done);
    else if (item) update.mutate({ ...input, id: item.id }, done);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? "品目を追加" : readOnly ? "品目（共通）" : "品目を編集" }} />
      {readOnly && (
        <Text style={styles.muted}>
          最初から用意されている共通の品目は編集できません。表記ゆれを直したいときは、同じ名前で家族の品目として追加すると、そちらが優先されます。
        </Text>
      )}
      <Card>
        <Field label="品目名（買い物リストに書く名前）" value={name} onChangeText={setName} editable={!readOnly} placeholder="例：ぬか漬けの素" />
        <Text style={styles.label}>カテゴリ</Text>
        <View style={styles.wrap}>
          {CATEGORY_NAMES.map((c, i) => (
            <Chip key={c} label={c} selected={categoryId === i + 1} onPress={readOnly ? undefined : () => setCategoryId(i + 1)} />
          ))}
        </View>
      </Card>
      <Card>
        <SectionTitle>日持ち（期限の推定に使う）</SectionTitle>
        <Field label="購入してからの日数" value={shelfDays} onChangeText={setShelfDays} keyboardType="number-pad" inputMode="numeric" editable={!readOnly} />
        <Field
          label="冷凍したときの日数（冷凍しないなら空欄）"
          value={frozenDays}
          onChangeText={setFrozenDays}
          keyboardType="number-pad"
          inputMode="numeric"
          editable={!readOnly}
        />
      </Card>
      <Card>
        <SectionTitle>別名</SectionTitle>
        <Text style={styles.muted}>レシートの略称や商品名の言い方を「、」区切りで入れると、AI 判定で見つけやすくなります。</Text>
        <Field label="別名" value={aliases} onChangeText={setAliases} editable={!readOnly} placeholder="例：ぬかどこ、ぬか床" />
      </Card>

      <ErrorText error={error} />
      {!readOnly && (
        <Button title={isNew ? "追加する" : "保存する"} loading={busy} disabled={!name.trim()} onPress={save} />
      )}
      {!isNew && !readOnly && item && (
        <Button
          title="この品目を削除"
          variant="danger"
          loading={remove.isPending}
          onPress={() =>
            confirmAction(`「${item.name}」を削除しますか？`, "削除", () =>
              remove.mutate(item.id, { onSuccess: () => router.back() }))}
        />
      )}
    </Screen>
  );
}
