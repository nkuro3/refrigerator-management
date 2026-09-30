// Web Push 用の VAPID 鍵を作る（最初に1回だけ実行する）
//   deno run supabase/scripts/generate-vapid-keys.ts
// 出力:
//   VAPID_KEYS=...                    → Edge Function のシークレット（秘密鍵を含む。コミットしない）
//   EXPO_PUBLIC_VAPID_PUBLIC_KEY=...  → apps/mobile/.env（公開鍵。Web 版に組み込まれる）
import { exportApplicationServerKey, exportVapidKeys, generateVapidKeys } from "jsr:@negrel/webpush@0.5.0";

const keys = await generateVapidKeys({ extractable: true });
console.log(`VAPID_KEYS='${JSON.stringify(await exportVapidKeys(keys))}'`);
console.log(`EXPO_PUBLIC_VAPID_PUBLIC_KEY=${await exportApplicationServerKey(keys)}`);
