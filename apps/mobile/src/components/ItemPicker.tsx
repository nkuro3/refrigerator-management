import { CATEGORY_NAMES, type ItemMaster } from "@fridge/shared";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useHousehold } from "../lib/auth";
import { useCreateItemMaster, useItemMasters } from "../lib/queries";
import { Button, Chip, colors, ErrorText, Field, styles } from "./ui";

type Props = {
  visible: boolean;
  initialQuery?: string;
  onClose: () => void;
  onSelect: (item: ItemMaster) => void;
};

function matches(item: ItemMaster, q: string): boolean {
  if (!q) return true;
  return item.name.includes(q) || item.aliases.some((a) => a.includes(q));
}

// 品目を選ぶ。見つからなければその場で世帯の品目として追加できる
export function ItemPicker({ visible, initialQuery = "", onClose, onSelect }: Props) {
  const household = useHousehold();
  const { data: items = [] } = useItemMasters();
  const createItem = useCreateItemMaster();
  const [query, setQuery] = useState(initialQuery);
  const [creating, setCreating] = useState(false);
  const [categoryId, setCategoryId] = useState<number>(CATEGORY_NAMES.length); // その他
  const [shelfDays, setShelfDays] = useState("7");
  const [frozenDays, setFrozenDays] = useState("30");

  const q = query.trim();
  const filtered = useMemo(() => items.filter((i) => matches(i, q)).slice(0, 100), [items, q]);

  const reset = () => {
    setCreating(false);
    setQuery(initialQuery);
  };

  const submitNew = () => {
    createItem.mutate({
      householdId: household.id,
      name: q,
      categoryId,
      shelfDays: Math.max(1, Number(shelfDays) || 7),
      frozenShelfDays: frozenDays.trim() === "" ? null : Math.max(1, Number(frozenDays) || 30),
    }, {
      onSuccess: (item) => {
        reset();
        onSelect(item);
      },
    }); // 失敗時は createItem.error を表示する
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onShow={() => setQuery(initialQuery)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ padding: 16, gap: 12 }}>
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <Text style={styles.title}>{creating ? "品目を追加" : "品目を選ぶ"}</Text>
            <Button title="閉じる" variant="ghost" small onPress={() => { reset(); onClose(); }} />
          </View>
          <Field label="品目名" value={query} onChangeText={setQuery} placeholder="例：レタス、お酢" autoFocus />
        </View>

        {creating ? (
          <View style={{ padding: 16, gap: 12 }}>
            <Text style={styles.label}>カテゴリ</Text>
            <View style={styles.wrap}>
              {CATEGORY_NAMES.map((name, i) => (
                <Chip key={name} label={name} selected={categoryId === i + 1} onPress={() => setCategoryId(i + 1)} />
              ))}
            </View>
            <Field label="日持ちの目安（日）" value={shelfDays} onChangeText={setShelfDays} keyboardType="number-pad" />
            <Field label="冷凍したときの日持ち（日・冷凍しないなら空欄）" value={frozenDays} onChangeText={setFrozenDays} keyboardType="number-pad" />
            <ErrorText error={createItem.error} />
            <Button title={`「${q}」を追加して選ぶ`} disabled={!q} loading={createItem.isPending} onPress={submitNew} />
            <Button title="戻る" variant="ghost" onPress={() => setCreating(false)} />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(i) => i.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48 }}
            ListHeaderComponent={
              q && !items.some((i) => i.name === q) ? (
                <Pressable onPress={() => setCreating(true)} style={{ paddingVertical: 14 }}>
                  <Text style={{ color: colors.primary, fontWeight: "700" }}>＋「{q}」を新しい品目として追加</Text>
                </Pressable>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => { reset(); onSelect(item); }}
                style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.border }}
              >
                <Text style={styles.body}>{item.name}</Text>
                <Text style={styles.muted}>
                  {CATEGORY_NAMES[item.category_id - 1]}
                  {item.household_id ? "・家族で追加" : ""}
                  {item.aliases.length > 0 ? `・${item.aliases.slice(0, 3).join("、")}` : ""}
                </Text>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
