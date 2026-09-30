import { categoryName, groupSameProducts, todayJst } from "@fridge/shared";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { EndSheet } from "../../components/EndSheet";
import { ProductRow } from "../../components/ProductRow";
import { Button, Card, colors, Empty, Loading, styles } from "../../components/ui";
import { useActiveProducts, useAddToShopping, useItemMasters } from "../../lib/queries";
import type { ProductWithItem } from "@fridge/shared";

// 品目詳細: その品目の在庫を一覧し、まとめて終了操作や買い物リスト追加ができる
export default function ItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: products = [], isLoading } = useActiveProducts();
  const { data: masters = [] } = useItemMasters();
  const addToShopping = useAddToShopping();
  const [ending, setEnding] = useState<ProductWithItem | null>(null);
  const today = todayJst();

  const master = masters.find((m) => m.id === id);
  const items = products.filter((p) => p.item_master_id === id);
  const groups = groupSameProducts(items, today);

  if (isLoading) return <Loading />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 48 }}>
      <Stack.Screen options={{ title: master?.name ?? "品目" }} />
      <View style={{ padding: 16, gap: 12 }}>
        <Card>
          <Text style={styles.title}>{master?.name} ×{items.length}</Text>
          {master && (
            <Text style={styles.muted}>
              {categoryName(master.category_id)}・日持ちの目安 {master.shelf_days}日
              {master.frozen_shelf_days ? `（冷凍 ${master.frozen_shelf_days}日）` : ""}
            </Text>
          )}
          <Button
            title={addToShopping.isSuccess ? "買い物リストに追加しました" : "買い物リストに追加"}
            variant="secondary"
            small
            disabled={addToShopping.isSuccess || !master}
            loading={addToShopping.isPending}
            onPress={() => master && addToShopping.mutate({ itemMasterId: master.id })}
          />
          {master && (
            <Button
              title={master.household_id ? "品目の設定を編集" : "品目の設定を見る"}
              variant="ghost"
              small
              onPress={() => router.push({ pathname: "/items/[id]", params: { id: master.id } })}
            />
          )}
        </Card>
      </View>
      {groups.length === 0 ? (
        <Empty title="在庫はありません" />
      ) : (
        groups.map((g) => (
          <View key={g.key}>
            <ProductRow
              product={g.products[0]!}
              count={g.products.length}
              today={today}
              showItemName={false}
              onPress={() => router.push({ pathname: "/product/[id]", params: { id: g.products[0]!.id } })}
            />
            <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.card }}>
              <Button title="1つ使い切った／捨てた" variant="secondary" small onPress={() => setEnding(g.products[0]!)} />
            </View>
          </View>
        ))
      )}
      <EndSheet product={ending} isLastOfItem={items.length === 1} onClose={() => setEnding(null)} />
    </ScrollView>
  );
}
