// まとめ登録: レシートと実物の写真から商品を特定する
// POST { receiptPath: string | null, photoPaths: string[] }  （パスは photos バケット内）
// 画像はアプリが先にアップロードし、ここでは呼び出したユーザーの権限でダウンロードする（RLS が効く）
//
// 1. 抽出: OpenAI gpt-6-luna が画像から商品名・個数・単価・冷凍・一般名を読み取る
// 2. 判定: TypeSafe Jev が商品ごとに品目マスタのどれに当たるかを選ぶ（該当なしなら 1 の提案を新しい品目にする）
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { corsHeaders } from "./cors.ts";
import { buildJevRequest, interpretJevAnswers, type JevAnswer, type Judgement, type Master } from "./jev.ts";
import { extractResponsesText, normalizeExtraction, resolveCandidate } from "./normalize.ts";
import { buildUserText, CATEGORY_NAMES, EXTRACTION_INSTRUCTION, EXTRACTION_SCHEMA } from "./prompt.ts";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-6-luna";
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = Deno.env.get("JEV_MODEL") ?? "jev-latest";
const MAX_PHOTOS = 4;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------- 1. 抽出（gpt-6-luna） ----------
async function extract(images: string[], hasReceipt: boolean, photoCount: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY") ?? ""}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          { role: "system", content: EXTRACTION_INSTRUCTION },
          {
            role: "user",
            content: [
              { type: "input_text", text: buildUserText(hasReceipt, photoCount) },
              ...images.map((b64) => ({ type: "input_image", image_url: `data:image/jpeg;base64,${b64}` })),
            ],
          },
        ],
        reasoning: { effort: "low" },
        text: {
          format: { type: "json_schema", name: "purchase_extraction", strict: true, schema: EXTRACTION_SCHEMA },
        },
        store: false,
      }),
    });
  } catch (e) {
    throw new ApiError(502, `openai: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new ApiError(res.status, `openai: ${res.status} ${(await res.text()).slice(0, 500)}`);
  const text = extractResponsesText(await res.json());
  if (!text) throw new ApiError(502, "openai: empty or refused output");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(502, "openai: invalid json output");
  }
}

// ---------- 2. 判定（Jev） ----------
async function judge(
  item: Parameters<typeof buildJevRequest>[0],
  masters: Master[],
): Promise<Judgement | null> {
  const { request, index } = buildJevRequest(item, masters, CATEGORY_NAMES, JEV_MODEL);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(JEV_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("TYPESAFE_API_KEY") ?? ""}`,
        },
        body: JSON.stringify(request),
      });
      if (res.status === 429 || res.status === 529 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 300 * 2 ** attempt)); // 混雑時は少し待って再試行
        continue;
      }
      if (!res.ok) {
        console.error("jev failed", res.status, (await res.text()).slice(0, 500));
        return null;
      }
      const body = await res.json() as { answers?: Record<string, JevAnswer> };
      return interpretJevAnswers(body.answers, index, CATEGORY_NAMES);
    } catch (e) {
      console.error("jev error", e);
    }
  }
  return null; // 判定できなかった場合は、一般名の一致か新しい品目の提案で代用する
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );

  let body: { receiptPath?: unknown; photoPaths?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const receiptPath = typeof body.receiptPath === "string" ? body.receiptPath : null;
  const photoPaths = Array.isArray(body.photoPaths)
    ? body.photoPaths.filter((p): p is string => typeof p === "string").slice(0, MAX_PHOTOS)
    : [];
  if (!receiptPath && photoPaths.length === 0) return json({ error: "no images" }, 400);

  // 画像のダウンロード（他世帯のパスは RLS で拒否される）
  const images: string[] = [];
  for (const path of [receiptPath, ...photoPaths].filter((p): p is string => p !== null)) {
    const { data, error } = await supabase.storage.from("photos").download(path);
    if (error || !data) return json({ error: `cannot read image: ${path}` }, 403);
    images.push(encodeBase64(new Uint8Array(await data.arrayBuffer())));
  }

  // 品目マスタ（共通＋世帯）
  const { data: masterRows, error: masterError } = await supabase
    .from("item_masters")
    .select("id, name, aliases, category_id")
    .order("category_id")
    .order("name");
  if (masterError) return json({ error: masterError.message }, 500);
  const masters = (masterRows ?? []) as Master[];

  let raw: unknown;
  try {
    raw = await extract(images, receiptPath !== null, photoPaths.length);
  } catch (e) {
    console.error(e);
    const limited = e instanceof ApiError && e.status === 429; // 利用上限・残高不足も 429 で返る
    return json({ error: limited ? "rate_limited" : "analysis failed" }, limited ? 429 : 502);
  }

  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // 日本時間
  const extraction = normalizeExtraction(raw, CATEGORY_NAMES, today);

  // 商品ごとに並列で判定する
  const judgements = await Promise.all(extraction.items.map((item) => judge(item, masters)));
  const items = extraction.items.map((item, i) => resolveCandidate(item, judgements[i] ?? null, masters));

  return json({ purchasedOn: extraction.purchasedOn, items, model: `${OPENAI_MODEL} + ${JEV_MODEL}` });
});
