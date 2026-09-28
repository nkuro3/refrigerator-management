import type { DraftItem } from "@fridge/shared";
import { useSyncExternalStore } from "react";

// 撮影画面から確認画面へ、登録途中のデータを受け渡すための小さなストア
export type RegisterDraft = {
  purchasedOn: string;
  receiptPath: string | null;
  photoPaths: string[];
  items: DraftItem[];
  model?: string;
};

let draft: RegisterDraft | null = null;
const listeners = new Set<() => void>();

export const draftStore = {
  get: () => draft,
  set(next: RegisterDraft | null) {
    draft = next;
    listeners.forEach((l) => l());
  },
  update(fn: (d: RegisterDraft) => RegisterDraft) {
    if (draft) draftStore.set(fn(draft));
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useRegisterDraft(): RegisterDraft | null {
  return useSyncExternalStore(draftStore.subscribe, draftStore.get);
}
