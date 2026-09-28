import { CATEGORY_NAMES, type ShoppingListItem } from "@fridge/shared";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { ItemPicker } from "../../components/ItemPicker";
import { Button, Card, colors, Empty, ErrorText, Loading, SectionTitle, styles } from "../../components/ui";
import { useAddToShopping, useDeleteShoppingItem, useSetPurchased, useShoppingList } from "../../lib/queries";

export default function Shopping() {
  const { data: items = [], isLoading, error, refetch, isRefetching } = useShoppingList();
  const setPurchased = useSetPurchased();
  const remove = useDeleteShoppingItem();
  const add = useAddToShopping();
  const [picking, setPicking] = useState(false);

  const open = items.filter((i) => !i.is_purchased);
  const done = items.filter((i) => i.is_purchased);
  const byCategory = useMemo(() => {
    const map = new Map<number, ShoppingListItem[]>();
    for (const i of open) map.set(i.item_masters.category_id, [...(map.get(i.item_masters.category_id) ?? []), i]);
    return [...map.entries()].sort(([a], [b]) => a - b);
  }, [open]);

  if (isLoading) return <Loading />;

  const row = (i: ShoppingListItem) => (
    <View key={i.id} style={[styles.row, { paddingVertical: 8 }]}>
      <Pressable
        onPress={() => setPurchased.mutate({ id: i.id, purchased: !i.is_purchased })}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: i.is_purchased }}
        style={[styles.row, { flex: 1 }]}
      >
        <View
          style={{
            width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.primary,
            backgroundColor: i.is_purchased ? colors.primary : "transparent", alignItems: "center", justifyContent: "center",
          }}
        >
          {i.is_purchased && <Text style={{ color: colors.primaryText, fontWeight: "700" }}>✓</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.body, i.is_purchased && { textDecorationLine: "line-through", color: colors.sub }]}>
            {i.item_masters.name}
          </Text>
          {i.note ? <Text style={styles.muted}>{i.note}</Text> : null}
        </View>
      </Pressable>
      <Button title="削除" variant="ghost" small onPress={() => remove.mutate(i.id)} />
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    >
      <Button title="＋ 品目を追加" variant="secondary" onPress={() => setPicking(true)} />
      <ErrorText error={error ?? add.error} />
      {open.length === 0 ? (
        <Empty title={"買うものはありません。\n使い切ったときに追加すると、ここに並びます。"} />
      ) : (
        byCategory.map(([cat, list]) => (
          <Card key={cat}>
            <SectionTitle>{CATEGORY_NAMES[cat - 1]}</SectionTitle>
            {list.map(row)}
          </Card>
        ))
      )}
      {done.length > 0 && (
        <Card>
          <SectionTitle>購入済み（直近3日）</SectionTitle>
          {done.map(row)}
        </Card>
      )}
      <ItemPicker
        visible={picking}
        onClose={() => setPicking(false)}
        onSelect={(item) => {
          setPicking(false);
          add.mutate({ itemMasterId: item.id });
        }}
      />
    </ScrollView>
  );
}
