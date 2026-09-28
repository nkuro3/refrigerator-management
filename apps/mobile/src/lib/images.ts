import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { PHOTO_BUCKET, supabase } from "./supabase";

const MAX_EDGE = 1280; // 無料枠の容量を節約するため長辺1280pxに縮小する

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function compress(uri: string, width: number, height: number): Promise<Uint8Array> {
  const context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > MAX_EDGE) {
    context.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const image = await context.renderAsync();
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
  if (!result.base64) throw new Error("画像の変換に失敗しました");
  return base64ToBytes(result.base64);
}

export type LocalImage = { uri: string; width: number; height: number };

// 圧縮して photos/<household_id>/<folder>/<random>.jpg にアップロードし、パスを返す
export async function uploadPhoto(householdId: string, folder: string, image: LocalImage): Promise<string> {
  const bytes = await compress(image.uri, image.width, image.height);
  const path = `${householdId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}

export async function removePhotos(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await supabase.storage.from(PHOTO_BUCKET).remove(paths);
}

// 非公開バケットの画像を表示するための署名付きURL（1時間）
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(unique, 3600);
  if (error || !data) return {};
  return Object.fromEntries(
    data.flatMap((d) => (d.signedUrl && d.path ? [[d.path, d.signedUrl] as const] : [])),
  );
}
