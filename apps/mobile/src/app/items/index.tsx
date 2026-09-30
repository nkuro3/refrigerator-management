import { CATEGORY_NAMES, type ItemMaster } from "@fridge/shared";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Button, Chip, colors, Empty, ErrorText, Loading, styles } from "../../components/ui";
import { useItemMasters } from "../../lib/queries";

function matches(item: ItemMaster, q: string): boolean {
  if (!q) return true;
  return item.name.includes(q) || item.aliases.some((a) => a.includes(q));
}

// 品目の管理: 品目マスタの一覧・検索と、家族の品目の追加・編集
export default function Items() {
  const { data: items = [], isLoading, error } = useItemMasters();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<number | null>(null);
  const [onlyOwn, setOnlyOwn] = useState(false);

  const q = query.trim();
  const filtered = useMemo(
    () =>
      items
        .filter((i) => (category ? i.category_id === category : true))
        .filter((i) => (onlyOwn ? i.household_id !== null : true))
        .filter((i) => matches(i, q)),
    [items, category, onlyOwn, q],
  );

  if (isLoading) return <Loading />;

  return (
    <FlatList
      data={filtered}
      keyExtractor={(i) => i.id}
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ padding: 16, gap: 12 }}>
          <Button
            title={q && !items.some((i) => i.name === q) ? `＋「${q}」を品目に追加` : "＋ 品目を追加"}
            onPress={() => router.push({ pathname: "/items/[id]", params: { id: "new", name: q } })}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="品目名・別名で検索"
            placeholderTextColor={colors.sub}
            style={styles.input}
            accessibilityLabel="品目を検索"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Chip label="すべて" selected={category === null} onPress={() => setCategory(null)} />
            {CATEGORY_NAMES.map((name, i) => (
              <Chip key={name} label={name} selected={category === i + 1} onPress={() => setCategory(i + 1)} />
            ))}
          </ScrollView>
          <View style={styles.row}>
            <Chip label="家族で追加した品目だけ" selected={onlyOwn} onPress={() => setOnlyOwn(!onlyOwn)} />
            <Text style={styles.muted}>{filtered.length}件</Text>
          </View>
          <ErrorText error={error} />
        </View>
      }
      ListEmptyComponent={<Empty title="該当する品目はありません" />}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push({ pathname: "/items/[id]", params: { id: item.id } })}
          accessibilityRole="button"
          style={({ pressed }) => ({
            paddingVertical: 12,
            paddingHorizontal: 16,
            backgroundColor: pressed ? colors.soft : colors.card,
            borderBottomWidth: 1,
            borderColor: colors.border,
            gap: 4,
          })}
        >
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <Text style={[styles.body, { fontWeight: "600", flex: 1 }]}>{item.name}</Text>
            {item.household_id && <Chip label="家族で追加" tone="info" />}
          </View>
          <Text style={styles.muted} numberOfLines={1}>
            {CATEGORY_NAMES[item.category_id - 1]}・{item.shelf_days}日
            {item.frozen_shelf_days ? `（冷凍 ${item.frozen_shelf_days}日）` : ""}
            {item.aliases.length > 0 ? `・${item.aliases.join("、")}` : ""}
          </Text>
        </Pressable>
      )}
    />
  );
}
