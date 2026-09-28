import { todayJst, toDraftItems } from "@fridge/shared";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, colors, ErrorText, Screen, SectionTitle, styles } from "../../components/ui";
import { useHousehold } from "../../lib/auth";
import { draftStore } from "../../lib/draft-store";
import { type LocalImage, removePhotos, uploadPhoto } from "../../lib/images";
import { AnalyzeError, analyzePurchase } from "../../lib/queries";

const MAX_PHOTOS = 4;

async function takePicture(fromLibrary: boolean, multiple: boolean): Promise<LocalImage[]> {
  if (!fromLibrary) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error("カメラの使用を許可してください（設定アプリから変更できます）");
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: "images",
    quality: 0.8,
    allowsMultipleSelection: fromLibrary && multiple,
    selectionLimit: multiple ? MAX_PHOTOS : 1,
  };
  const result = fromLibrary
    ? await ImagePicker.launchImageLibraryAsync(options)
    : await ImagePicker.launchCameraAsync(options);
  if (result.canceled) return [];
  return result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
}

// まとめ登録の1ステップ目: レシートと、買ってきた食品をまとめて撮る
export default function RegisterCapture() {
  const household = useHousehold();
  const [receipt, setReceipt] = useState<LocalImage | null>(null);
  const [photos, setPhotos] = useState<LocalImage[]>([]);
  const [phase, setPhase] = useState<"idle" | "uploading" | "analyzing">("idle");
  const [error, setError] = useState<unknown>(null);

  const pick = async (target: "receipt" | "photos", fromLibrary: boolean) => {
    setError(null);
    try {
      const images = await takePicture(fromLibrary, target === "photos");
      if (images.length === 0) return;
      if (target === "receipt") setReceipt(images[0]!);
      else setPhotos((prev) => [...prev, ...images].slice(0, MAX_PHOTOS));
    } catch (e) {
      setError(e);
    }
  };

  const analyze = async () => {
    setError(null);
    const uploaded: string[] = [];
    try {
      setPhase("uploading");
      const receiptPath = receipt ? await uploadPhoto(household.id, "receipts", receipt) : null;
      if (receiptPath) uploaded.push(receiptPath);
      const photoPaths: string[] = [];
      for (const p of photos) {
        const path = await uploadPhoto(household.id, "purchases", p);
        photoPaths.push(path);
        uploaded.push(path);
      }

      setPhase("analyzing");
      const result = await analyzePurchase(receiptPath, photoPaths);
      if (result.items.length === 0) {
        throw new Error("食品を見つけられませんでした。もう一度撮影するか、手入力で登録してください。");
      }
      draftStore.set({
        purchasedOn: result.purchasedOn ?? todayJst(),
        receiptPath,
        photoPaths,
        items: toDraftItems(result.items),
        model: result.model,
      });
      router.replace("/register/confirm");
    } catch (e) {
      await removePhotos(uploaded);
      setError(e);
    } finally {
      setPhase("idle");
    }
  };

  const busy = phase !== "idle";

  return (
    <Screen>
      <Card>
        <SectionTitle>1. レシート</SectionTitle>
        <Text style={styles.muted}>品名と価格、購入日を読み取ります。なくても登録できます。</Text>
        {receipt ? (
          <Thumb image={receipt} onRemove={() => setReceipt(null)} tall />
        ) : (
          <View style={styles.row}>
            <Button title="レシートを撮る" onPress={() => pick("receipt", false)} style={{ flex: 1 }} disabled={busy} />
            <Button title="写真から選ぶ" variant="secondary" onPress={() => pick("receipt", true)} disabled={busy} />
          </View>
        )}
      </Card>

      <Card>
        <SectionTitle>2. 買ってきた食品（最大{MAX_PHOTOS}枚）</SectionTitle>
        <Text style={styles.muted}>テーブルに並べて、まとめて撮影してください。1点だけの登録にも使えます。</Text>
        <View style={styles.wrap}>
          {photos.map((p, i) => (
            <Thumb key={p.uri} image={p} onRemove={() => setPhotos((prev) => prev.filter((_, j) => j !== i))} />
          ))}
        </View>
        {photos.length < MAX_PHOTOS && (
          <View style={styles.row}>
            <Button title="食品を撮る" onPress={() => pick("photos", false)} style={{ flex: 1 }} disabled={busy} />
            <Button title="写真から選ぶ" variant="secondary" onPress={() => pick("photos", true)} disabled={busy} />
          </View>
        )}
      </Card>

      <ErrorText error={error} />
      {error instanceof AnalyzeError && (
        <Button title="手入力で登録する" variant="secondary" onPress={() => router.replace("/register/manual")} />
      )}

      <Button
        title={phase === "uploading" ? "アップロード中…" : phase === "analyzing" ? "AIが判定中…（10〜30秒）" : "AIで商品を判定する"}
        loading={busy}
        disabled={!receipt && photos.length === 0}
        onPress={analyze}
      />
    </Screen>
  );
}

function Thumb({ image, onRemove, tall }: { image: LocalImage; onRemove: () => void; tall?: boolean }) {
  return (
    <View>
      <Image source={{ uri: image.uri }} style={{ width: tall ? 140 : 96, height: tall ? 200 : 96, borderRadius: 8 }} contentFit="cover" />
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel="写真を削除"
        style={{ position: "absolute", top: 4, right: 4, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }}
      >
        <Text style={{ color: colors.primaryText }}>×</Text>
      </Pressable>
    </View>
  );
}
