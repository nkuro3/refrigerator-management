import {
  type AnalysisResult,
  type DashboardSummary,
  type DiscardReason,
  type ItemMaster,
  type Product,
  type ProductWithItem,
  type RegisterPayload,
  type ShoppingListItem,
} from "@fridge/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "./supabase";

export const keys = {
  products: ["products"] as const,
  product: (id: string) => ["products", id] as const,
  itemMasters: ["item_masters"] as const,
  shopping: ["shopping"] as const,
  dashboard: (from: string, to: string) => ["dashboard", from, to] as const,
  members: ["members"] as const,
};

const PRODUCT_SELECT = "*, item_masters(name, category_id)";

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

// ---------- 取得 ----------
export function useActiveProducts() {
  return useQuery({
    queryKey: keys.products,
    queryFn: async () =>
      unwrap(await supabase.from("products").select(PRODUCT_SELECT).is("ended_at", null)) as ProductWithItem[],
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: keys.product(id),
    queryFn: async () =>
      unwrap(await supabase.from("products").select(PRODUCT_SELECT).eq("id", id).single()) as ProductWithItem,
  });
}

export function useItemMasters() {
  return useQuery({
    queryKey: keys.itemMasters,
    staleTime: 10 * 60_000,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("item_masters")
          .select("id, household_id, category_id, name, aliases, shelf_days, frozen_shelf_days")
          .order("category_id")
          .order("name"),
      ) as ItemMaster[],
  });
}

export function useShoppingList() {
  return useQuery({
    queryKey: keys.shopping,
    queryFn: async () => {
      const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
      return unwrap(
        await supabase
          .from("shopping_list_items")
          .select("id, item_master_id, note, is_purchased, purchased_at, created_at, item_masters(name, category_id)")
          .or(`is_purchased.eq.false,purchased_at.gte.${since}`)
          .order("created_at"),
      ) as unknown as ShoppingListItem[];
    },
  });
}

export function useDashboardSummary(from: string, to: string) {
  return useQuery({
    queryKey: keys.dashboard(from, to),
    queryFn: async () => {
      const rows = unwrap(await supabase.rpc("dashboard_summary", { p_from: from, p_to: to })) as DashboardSummary[];
      return rows[0] ?? null;
    },
  });
}

export type Member = { user_id: string; role: "owner" | "member"; profiles: { display_name: string } | null };

export function useMembers() {
  return useQuery({
    queryKey: keys.members,
    queryFn: async () => {
      const members = unwrap(await supabase.from("household_members").select("user_id, role")) as Omit<Member, "profiles">[];
      const profiles = unwrap(
        await supabase.from("profiles").select("user_id, display_name").in("user_id", members.map((m) => m.user_id)),
      ) as { user_id: string; display_name: string }[];
      return members.map((m) => ({ ...m, profiles: profiles.find((p) => p.user_id === m.user_id) ?? null })) as Member[];
    },
  });
}

// ---------- 更新 ----------
function useInvalidate() {
  const qc = useQueryClient();
  return (...queryKeys: readonly (readonly unknown[])[]) =>
    Promise.all(queryKeys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

export function useUpdateProduct() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Product> }) =>
      unwrap(await supabase.from("products").update(patch).eq("id", id).select("id").single()),
    onSuccess: () => invalidate(keys.products, ["dashboard"]),
  });
}

export type EndInput = {
  product: ProductWithItem;
  reason: "used_up" | "discarded";
  discardReason: DiscardReason | null;
  addToShopping: boolean;
};

// 使い切った／捨てた。あわせて買い物リストに追加できる
export function useEndProduct() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ product, reason, discardReason, addToShopping }: EndInput) => {
      unwrap(
        await supabase
          .from("products")
          .update({
            ended_at: new Date().toISOString(),
            end_reason: reason,
            discard_reason: reason === "discarded" ? discardReason ?? "other" : null,
          })
          .eq("id", product.id)
          .select("id")
          .single(),
      );
      if (addToShopping) {
        unwrap(
          await supabase.rpc("add_to_shopping_list", {
            p_item_master_id: product.item_master_id,
            p_note: product.name,
            p_product_id: product.id,
          }),
        );
      }
    },
    onSuccess: () => invalidate(keys.products, keys.shopping, ["dashboard"]),
  });
}

export function useUndoEnd() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(
        await supabase
          .from("products")
          .update({ ended_at: null, end_reason: null, discard_reason: null })
          .eq("id", id)
          .select("id")
          .single(),
      ),
    onSuccess: () => invalidate(keys.products, ["dashboard"]),
  });
}

export function useAddToShopping() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ itemMasterId, note }: { itemMasterId: string; note?: string | null }) =>
      unwrap(await supabase.rpc("add_to_shopping_list", { p_item_master_id: itemMasterId, p_note: note ?? null })),
    onSuccess: () => invalidate(keys.shopping),
  });
}

export function useSetPurchased() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, purchased }: { id: string; purchased: boolean }) => {
      if (purchased) {
        unwrap(
          await supabase
            .from("shopping_list_items")
            .update({ is_purchased: true, purchased_at: new Date().toISOString() })
            .eq("id", id)
            .select("id")
            .single(),
        );
      } else {
        // 同じ品目が未購入で残っていれば、そちらにまとめる
        unwrap(await supabase.rpc("unpurchase_shopping_item", { p_id: id }));
      }
    },
    onSuccess: () => invalidate(keys.shopping),
  });
}

export function useDeleteShoppingItem() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from("shopping_list_items").delete().eq("id", id)),
    onSuccess: () => invalidate(keys.shopping),
  });
}

export type NewItemInput = {
  householdId: string;
  name: string;
  categoryId: number;
  shelfDays: number;
  frozenShelfDays: number | null;
};

export function useCreateItemMaster() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: NewItemInput) =>
      unwrap(
        await supabase
          .from("item_masters")
          .insert({
            household_id: input.householdId,
            name: input.name.trim(),
            category_id: input.categoryId,
            shelf_days: input.shelfDays,
            frozen_shelf_days: input.frozenShelfDays,
          })
          .select("id, household_id, category_id, name, aliases, shelf_days, frozen_shelf_days")
          .single(),
      ) as ItemMaster,
    onSuccess: () => invalidate(keys.itemMasters),
  });
}

export function useRegisterPurchase() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (payload: RegisterPayload) =>
      unwrap(await supabase.rpc("register_purchase", { p_payload: payload })) as string,
    onSuccess: () => invalidate(keys.products, keys.itemMasters, keys.shopping),
  });
}

export class AnalyzeError extends Error {
  constructor(message: string, public rateLimited = false) {
    super(message);
  }
}

export async function analyzePurchase(receiptPath: string | null, photoPaths: string[]): Promise<AnalysisResult> {
  const { data, error } = await supabase.functions.invoke("analyze-purchase", {
    body: { receiptPath, photoPaths },
  });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 429) {
      throw new AnalyzeError("AI判定の利用上限に達しました（OpenAI の残高や上限を確認してください）。手入力でも登録できます。", true);
    }
    throw new AnalyzeError("AI判定に失敗しました。時間をおいてもう一度試してください。");
  }
  return data as AnalysisResult;
}

// ---------- 家族間の同期 ----------
// 他の家族が在庫や買い物リストを変えたら、表示中のデータを取り直す
export function useRealtimeSync(householdId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!householdId) return;
    const filter = `household_id=eq.${householdId}`;
    const channel = supabase
      .channel(`household:${householdId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "products", filter }, () => {
        void qc.invalidateQueries({ queryKey: keys.products });
        void qc.invalidateQueries({ queryKey: ["dashboard"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shopping_list_items", filter }, () => {
        void qc.invalidateQueries({ queryKey: keys.shopping });
      })
      // DELETE はフィルタが効かないので、フィルタなしで受けて取り直す
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "shopping_list_items" }, () => {
        void qc.invalidateQueries({ queryKey: keys.shopping });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [householdId, qc]);
}
