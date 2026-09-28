import { categoryName, type ItemMaster, todayJst } from "@fridge/shared";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { ItemPicker } from "../../components/ItemPicker";
import { Button, Card, colors, ErrorText, Field, Screen, styles } from "../../components/ui";
import { useRegisterPurchase } from "../../lib/queries";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 手入力で1品目を登録する（レシートがない・AIの上限に達したときなど）
export default function RegisterManual() {
  const register = useRegisterPurchase();
  const [item, setItem] = useState<ItemMaster | null>(null);
  const [picking, setPicking] = useState(true);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState("");
  const [purchasedOn, setPurchasedOn] = useState(todayJst());
  const [frozen, setFrozen] = useState(false);

  const submit = () => {
    if (!item) return;
    register.mutate({
      purchased_on: purchasedOn,
      receipt_image_path: null,
      item_photo_paths: [],
      image_path: null,
      new_items: [],
      items: [{
        item_master_id: item.id,
        new_item_key: null,
        name: name.trim() || item.name,
        unit_price: price.trim() === "" ? null : Number(price.replace(/\D/g, "")) || 0,
        quantity,
        is_frozen: frozen,
      }],
    }, { onSuccess: () => router.back() }); // 失敗時は register.error を表示する
  };

  return (
    <Screen>
      <Card>
        <Text style={styles.label}>品目</Text>
        <Pressable onPress={() => setPicking(true)} accessibilityRole="button">
          <Text style={[styles.title, { color: colors.primary }]}>
            {item ? `${item.name}（${categoryName(item.category_id)}）` : "品目を選ぶ"} ›
          </Text>
        </Pressable>
        <Field label="商品名（任意）" value={name} onChangeText={setName} placeholder={item?.name ?? "例：ミツカン穀物酢"} />
        <View style={styles.row}>
          <Text style={styles.label}>個数</Text>
          <Button title="−" variant="secondary" small onPress={() => setQuantity((q) => Math.max(1, q - 1))} />
          <Text style={[styles.body, { minWidth: 24, textAlign: "center" }]}>{quantity}</Text>
          <Button title="＋" variant="secondary" small onPress={() => setQuantity((q) => Math.min(50, q + 1))} />
        </View>
        <Field label="1個あたりの価格（円・任意）" value={price} onChangeText={setPrice} keyboardType="number-pad" />
        <Field label="購入日" value={purchasedOn} onChangeText={setPurchasedOn} keyboardType="numbers-and-punctuation" />
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Text style={styles.body}>冷凍食品</Text>
          <Switch value={frozen} onValueChange={setFrozen} trackColor={{ true: colors.primary }} />
        </View>
      </Card>
      <ErrorText error={register.error} />
      <Button title="登録する" loading={register.isPending} disabled={!item || !DATE_RE.test(purchasedOn)} onPress={submit} />
      <ItemPicker
        visible={picking}
        onClose={() => setPicking(false)}
        onSelect={(m) => {
          setItem(m);
          setFrozen(false);
          setPicking(false);
        }}
      />
    </Screen>
  );
}
