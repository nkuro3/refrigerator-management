import {
  CATEGORY_NAMES,
  expiryStatus,
  groupByItem,
  groupSameProducts,
  isAlertTarget,
  todayJst,
} from "@fridge/shared";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { expiryTone, ProductRow } from "../../components/ProductRow";
import { Button, Chip, colors, Empty, ErrorText, Loading, styles } from "../../components/ui";
import { useActiveProducts } from "../../lib/queries";

type View_ = "item" | "product";

export default function Inventory() {
  const { data: products = [], isLoading, error, refetch, isRefetching } = useActiveProducts();
  const [view, setView] = useState<View_>("item");
  const [category, setCategory] = useState<number | null>(null);
  const today = todayJst();

  const filtered = useMemo(
    () => (category ? products.filter((p) => p.item_masters.category_id === category) : products),
    [products, category],
  );
  const categoriesInStock = useMemo(
    () => [...new Set(products.map((p) => p.item_masters.category_id))].sort((a, b) => a - b),
    [products],
  );
  const alertCount = products.filter((p) => isAlertTarget(p, today)).length;

  if (isLoading) return <Loading />;

  const header = (
    <View style={{ padding: 16, gap: 12 }}>
      <View style={styles.row}>
        <Button title="まとめて登録" onPress={() => router.push("/register")} style={{ flex: 1 }} />
        <Button title="手入力" variant="secondary" onPress={() => router.push("/register/manual")} style={{ flex: 1 }} />
      </View>
      {alertCount > 0 && (
        <Pressable onPress={() => router.navigate("/dashboard")} accessibilityRole="button">
          <Text style={{ color: colors.warn, fontWeight: "700" }}>
            使い切りたいものが{alertCount}件あります ›
          </Text>
        </Pressable>
      )}
      <View style={styles.row}>
        <Chip label="品目でまとめる" selected={view === "item"} onPress={() => setView("item")} />
        <Chip label="商品ごと" selected={view === "product"} onPress={() => setView("product")} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip label="すべて" selected={category === null} onPress={() => setCategory(null)} />
        {categoriesInStock.map((id) => (
          <Chip key={id} label={CATEGORY_NAMES[id - 1] ?? "その他"} selected={category === id} onPress={() => setCategory(id)} />
        ))}
      </ScrollView>
      <ErrorText error={error} />
    </View>
  );

  const refresh = <RefreshControl refreshing={isRefetching} onRefresh={refetch} />;
  const empty = <Empty title={products.length === 0 ? "まだ何も登録されていません。\n買い物から帰ったら、レシートと食品を撮影して登録しましょう。" : "このカテゴリの在庫はありません"} />;

  if (view === "item") {
    const groups = groupByItem(filtered, today);
    return (
      <FlatList
        data={groups}
        keyExtractor={(g) => g.itemMasterId}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        refreshControl={refresh}
        style={{ backgroundColor: colors.bg }}
        renderItem={({ item: g }) => {
          const status = expiryStatus(g.products[0]!, today);
          return (
            <Pressable
              onPress={() => router.push({ pathname: "/item/[id]", params: { id: g.itemMasterId } })}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingVertical: 14,
                paddingHorizontal: 16,
                backgroundColor: pressed ? colors.soft : colors.card,
                borderBottomWidth: 1,
                borderColor: colors.border,
              })}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.body, { fontWeight: "700" }]}>
                  {g.itemName}
                  <Text style={styles.muted}>  ×{g.count}</Text>
                </Text>
                <Text style={styles.muted}>{CATEGORY_NAMES[g.categoryId - 1]}</Text>
              </View>
              <Chip label={status.label} tone={expiryTone(status.kind)} />
            </Pressable>
          );
        }}
      />
    );
  }

  const productGroups = groupSameProducts(filtered, today);
  return (
    <FlatList
      data={productGroups}
      keyExtractor={(g) => g.key}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      refreshControl={refresh}
      style={{ backgroundColor: colors.bg }}
      renderItem={({ item: g }) => (
        <ProductRow
          product={g.products[0]!}
          count={g.products.length}
          today={today}
          onPress={() => router.push({ pathname: "/product/[id]", params: { id: g.products[0]!.id } })}
        />
      )}
    />
  );
}
