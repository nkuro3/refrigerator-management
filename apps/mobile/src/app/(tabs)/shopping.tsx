import { CATEGORY_NAMES, type ShoppingListItem } from "@fridge/shared";
import { useEffect, useMemo, useState } from "react";
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
  // 直前にチェックしたもの（数秒だけ「元に戻す」を出す）
  const [justBought, setJustBought] = useState<ShoppingListItem | null>(null);

  useEffect(() => {
    if (!justBought) return;
    const t = setTimeout(() => setJustBought(null), 5000);
    return () => clearTimeout(t);
  }, [justBought]);

  const open = items.filter((i) => !i.is_purchased);
  const byCategory = useMemo(() => {
    const map = new Map<number, ShoppingListItem[]>();
    for (const i of open) map.set(i.item_masters.category_id, [...(map.get(i.item_masters.category_id) ?? []), i]);
    return [...map.entries()].sort(([a], [b]) => a - b);
  }, [open]);

  if (isLoading) return <Loading />;

  const row = (i: ShoppingListItem) => (
    <View key={i.id} style={[styles.row, { paddingVertical: 8 }]}>
      <Pressable
        onPress={() => {
          setPurchased.mutate({ id: i.id, purchased: true });
          setJustBought(i);
        }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: false }}
        accessibilityLabel={`${i.item_masters.name}を買った`}
        style={[styles.row, { flex: 1 }]}
      >
        <View
          style={{
            width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.primary,
            alignItems: "center", justifyContent: "center",
          }}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.body}>{i.item_masters.name}</Text>
          {i.note ? <Text style={styles.muted}>{i.note}</Text> : null}
        </View>
      </Pressable>
      <Button title="削除" variant="ghost" small onPress={() => remove.mutate(i.id)} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 96 }} // 「元に戻す」のバーに隠れないように
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
        <ItemPicker
          visible={picking}
          onClose={() => setPicking(false)}
          onSelect={(item) => {
            setPicking(false);
            add.mutate({ itemMasterId: item.id });
          }}
        />
      </ScrollView>
      {justBought && (
        <View
          style={{
            position: "absolute", left: 16, right: 16, bottom: 16, flexDirection: "row", alignItems: "center",
            gap: 12, paddingVertical: 10, paddingLeft: 16, paddingRight: 8, borderRadius: 12, backgroundColor: colors.text,
          }}
        >
          <Text style={{ flex: 1, color: "#fff", fontSize: 15 }} numberOfLines={1}>
            「{justBought.item_masters.name}」を買いました
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setPurchased.mutate({ id: justBought.id, purchased: false });
              setJustBought(null);
            }}
            style={{ paddingHorizontal: 12, paddingVertical: 6 }}
          >
            <Text style={{ color: "#9FE0BE", fontWeight: "700", fontSize: 15 }}>元に戻す</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
