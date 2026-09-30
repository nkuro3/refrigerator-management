// 品目の判定（Jev）: 抽出した商品1件を品目マスタのどれかに振り分ける
// Choice の選択肢は1問255個までなので、「カテゴリ」と「カテゴリごとの品目」の質問を1回の呼び出しでまとめて投げる
// （Jev は1回の呼び出しの中で複数の質問を並列に答える）

export type Master = { id: string; name: string; aliases: string[]; category_id: number };

export type ExtractedForJudge = {
  name: string;
  receiptText: string | null;
  genericName: string;
  isFrozen: boolean;
};

export const NONE_KEY = "該当なし";
const MAX_OPTIONS = 254; // 255 から「該当なし」の分を引く

export type JevQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type JevRequest = {
  model: string;
  state: Record<string, string>;
  questions: Record<string, JevQuestion>;
};

// 選択肢のキー → 品目ID。世帯で追加した品目が共通品目と同名の場合はキーを区別する
export type OptionIndex = Map<string, Map<string, string>>; // questionId -> (optionKey -> masterId)

export function buildJevRequest(
  item: ExtractedForJudge,
  masters: Master[],
  categoryNames: readonly string[],
  model: string,
): { request: JevRequest; index: OptionIndex } {
  const index: OptionIndex = new Map();
  const questions: Record<string, JevQuestion> = {};

  const byCategory = new Map<number, Master[]>();
  for (const m of masters) byCategory.set(m.category_id, [...(byCategory.get(m.category_id) ?? []), m]);

  const categoryCriteria: Record<string, string> = {};
  categoryNames.forEach((name, i) => {
    const examples = (byCategory.get(i + 1) ?? []).slice(0, 12).map((m) => m.name).join("、");
    categoryCriteria[name] = examples ? `例：${examples}` : name;
  });
  questions.category = {
    type: "choice",
    instructions: "この食品はどのカテゴリに入るか。冷凍食品は中身で判断する。",
    criteria: categoryCriteria,
  };

  for (const [categoryId, list] of byCategory) {
    const criteria: Record<string, string> = {};
    const keys = new Map<string, string>();
    for (const m of list.slice(0, MAX_OPTIONS)) {
      const key = keys.has(m.name) || m.name === NONE_KEY ? `${m.name}（家族で追加）` : m.name;
      keys.set(key, m.id);
      criteria[key] = m.aliases.length > 0 ? `${m.name}。別名：${m.aliases.join("、")}` : m.name;
    }
    criteria[NONE_KEY] = "上のどれにも当てはまらない";
    const qid = `item_${categoryId}`;
    questions[qid] = {
      type: "choice",
      instructions:
        "この食品は、買い物リストに書くとしたらどの品目か。ブランド・容量・部位・種類の違いは同じ品目とみなす。冷凍食品は中身の品目。",
      criteria,
    };
    index.set(qid, keys);
  }

  const state: Record<string, string> = {
    商品名: item.name,
    一般名: item.genericName,
    冷凍食品: item.isFrozen ? "はい" : "いいえ",
  };
  if (item.receiptText) state["レシートの表記"] = item.receiptText;

  return { request: { model, state, questions }, index };
}

export type JevAnswer = { choice?: unknown; confidence?: unknown; probabilities?: unknown };

export type Judgement = {
  itemMasterId: string | null; // null = 該当なし
  confidence: number; // 0〜1（選んだ品目の確率）
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function probabilities(answer: JevAnswer | undefined): Record<string, number> {
  if (!answer) return {};
  if (answer.probabilities && typeof answer.probabilities === "object") {
    return Object.fromEntries(
      Object.entries(answer.probabilities as Record<string, unknown>).map(([k, v]) => [k, num(v)]),
    );
  }
  // probabilities がない場合は choice と confidence で代用する
  return typeof answer.choice === "string" ? { [answer.choice]: num(answer.confidence) || 1 } : {};
}

// P(品目) = P(カテゴリ) × P(品目 | そのカテゴリの質問) で全カテゴリを比べる
// カテゴリを取り違えても、別カテゴリの品目の質問で強く当たっていれば拾える
export function interpretJevAnswers(
  answers: Record<string, JevAnswer> | undefined,
  index: OptionIndex,
  categoryNames: readonly string[],
): Judgement {
  if (!answers) return { itemMasterId: null, confidence: 0 };
  const catProbs = probabilities(answers.category);

  let best: Judgement = { itemMasterId: null, confidence: 0 };
  let noneMass = 0;
  categoryNames.forEach((name, i) => {
    const pCat = catProbs[name] ?? 0;
    const qid = `item_${i + 1}`;
    const keys = index.get(qid);
    if (pCat === 0 || !keys) return;
    for (const [key, p] of Object.entries(probabilities(answers[qid]))) {
      const joint = pCat * p;
      if (key === NONE_KEY) {
        noneMass += joint;
      } else if (joint > best.confidence && keys.has(key)) {
        best = { itemMasterId: keys.get(key)!, confidence: joint };
      }
    }
  });

  // 「該当なし」の確率の合計が、いちばん有力な品目を上回るなら新しい品目として扱う
  if (noneMass > best.confidence) return { itemMasterId: null, confidence: noneMass };
  return best;
}
