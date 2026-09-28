// まとめ登録: レシートと実物の写真から商品を特定する
// POST { receiptPath: string | null, photoPaths: string[] }  （パスは photos バケット内）
// 画像はアプリが先にアップロードし、ここでは呼び出したユーザーの権限でダウンロードする（RLS が効く）
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { buildUserPrompt, CATEGORY_NAMES, RESPONSE_SCHEMA, SYSTEM_INSTRUCTION } from "./prompt.ts";
import { extractOutputText, type Master, normalizeAnalysis } from "./normalize.ts";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const PRIMARY_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
// 無料枠の上限（1日20回）に達したときの切り替え先
const FALLBACK_MODEL = Deno.env.get("GEMINI_FALLBACK_MODEL") ?? "gemini-3.5-flash-lite";
const MAX_PHOTOS = 4;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

class GeminiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ネットワークエラーや JSON の解析失敗も GeminiError(502) にそろえ、予備モデルで再試行できるようにする
async function callGemini(model: string, input: unknown[], withThinkingLevel: boolean): Promise<unknown> {
  try {
    return await requestGemini(model, input, withThinkingLevel);
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    throw new GeminiError(502, `${model}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function requestGemini(model: string, input: unknown[], withThinkingLevel: boolean): Promise<unknown> {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": Deno.env.get("GEMINI_API_KEY") ?? "",
    },
    body: JSON.stringify({
      model,
      system_instruction: SYSTEM_INSTRUCTION,
      input,
      ...(withThinkingLevel ? { generation_config: { thinking_level: "low" } } : {}),
      response_format: { type: "text", mime_type: "application/json", schema: RESPONSE_SCHEMA },
      store: false,
    }),
  });
  if (!res.ok) {
    throw new GeminiError(res.status, `${model}: ${res.status} ${(await res.text()).slice(0, 500)}`);
  }
  const text = extractOutputText(await res.json());
  if (!text) throw new GeminiError(502, `${model}: empty output`);
  return JSON.parse(text);
}

Deno.serve(async (req) => {
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

  const input = [
    {
      type: "text",
      text: buildUserPrompt(
        masters.map((m) => ({ name: m.name, category: CATEGORY_NAMES[m.category_id - 1] ?? "その他", aliases: m.aliases })),
        receiptPath !== null,
        photoPaths.length,
      ),
    },
    ...images.map((data) => ({ type: "image", data, mime_type: "image/jpeg" })),
  ];

  let raw: unknown;
  let model = PRIMARY_MODEL;
  try {
    raw = await callGemini(PRIMARY_MODEL, input, true);
  } catch (e) {
    // 上限到達（429）や一時的な失敗（5xx）は軽いモデルで再試行する
    const retryable = e instanceof GeminiError && (e.status === 429 || e.status >= 500);
    if (!retryable) {
      console.error(e);
      return json({ error: "analysis failed" }, 502);
    }
    try {
      model = FALLBACK_MODEL;
      raw = await callGemini(FALLBACK_MODEL, input, false);
    } catch (e2) {
      console.error(e, e2);
      const limited = e2 instanceof GeminiError && e2.status === 429;
      return json({ error: limited ? "rate_limited" : "analysis failed" }, limited ? 429 : 502);
    }
  }

  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // 日本時間
  const result = normalizeAnalysis(raw, masters, CATEGORY_NAMES, today);
  return json({ ...result, model });
});
