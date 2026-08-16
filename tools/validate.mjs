// BokiStudy コンテンツ検証スクリプト
// 使い方: node tools/validate.mjs            … 全単元を検証
//         node tools/validate.mjs s1-u02     … 指定単元のみ検証
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "docs", "data");

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

function loadJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    err(`${label}: JSONが読めません — ${e.message}`);
    return null;
  }
}

const curriculum = loadJson(join(DATA, "curriculum.json"), "curriculum.json");
const accountsDoc = loadJson(join(DATA, "accounts.json"), "accounts.json");
const topicsDoc = loadJson(join(DATA, "topics.json"), "topics.json");
if (!curriculum || !accountsDoc || !topicsDoc) {
  report();
}

// ---- マスタ検証 ----
const unitOrder = new Map(); // unitId -> 通し順
let order = 0;
for (const st of curriculum.stages) {
  for (const u of st.units) {
    if (unitOrder.has(u.id)) err(`curriculum: 単元ID重複 ${u.id}`);
    unitOrder.set(u.id, order++);
    if (!["available", "planned"].includes(u.status)) err(`curriculum: ${u.id} のstatus不正 "${u.status}"`);
  }
}
for (const st of curriculum.stages) {
  for (const u of st.units) {
    for (const p of u.prereq) if (!unitOrder.has(p)) err(`curriculum: ${u.id} のprereq "${p}" が存在しません`);
  }
}

const accountIds = new Map(); // id -> account
const CATS = ["asset", "liability", "equity", "revenue", "expense", "other"];
for (const a of accountsDoc.accounts) {
  if (accountIds.has(a.id)) err(`accounts: ID重複 ${a.id}`);
  accountIds.set(a.id, a);
  if (!CATS.includes(a.cat)) err(`accounts: ${a.id} のcat不正 "${a.cat}"`);
  if (!unitOrder.has(a.introducedIn)) err(`accounts: ${a.id} のintroducedIn "${a.introducedIn}" が存在しません`);
}

const topicIds = new Map();
for (const t of topicsDoc.topics) {
  if (topicIds.has(t.id)) err(`topics: ID重複 ${t.id}`);
  topicIds.set(t.id, t);
  if (!unitOrder.has(t.unitId)) err(`topics: ${t.id} のunitId "${t.unitId}" が存在しません`);
}

// ---- 単元コンテンツ検証 ----
const QTYPES = ["journal", "mc", "tf", "fill_number"];
const FIGKINDS = ["journal", "taccount", "bspl", "flow", "worksheet", "calcbox"];
const globalQids = new Set();

const targetUnit = process.argv[2] || null;
const availableUnits = [...curriculum.stages.flatMap((s) => s.units)]
  .filter((u) => u.status === "available")
  .filter((u) => !targetUnit || u.id === targetUnit);

for (const unit of availableUnits) {
  const uid = unit.id;
  const lessonPath = join(DATA, "lessons", `${uid}.json`);
  const qPath = join(DATA, "questions", `${uid}.json`);
  if (!existsSync(lessonPath)) { err(`${uid}: lessons/${uid}.json がありません（statusはavailable）`); continue; }
  if (!existsSync(qPath)) { err(`${uid}: questions/${uid}.json がありません（statusはavailable）`); continue; }
  const lesson = loadJson(lessonPath, `lessons/${uid}.json`);
  const qdoc = loadJson(qPath, `questions/${uid}.json`);
  if (!lesson || !qdoc) continue;

  // 問題ファイル
  const qids = new Map();
  let srsCount = 0;
  for (const q of qdoc.questions || []) {
    const tag = `questions/${uid} ${q.id}`;
    if (globalQids.has(q.id)) err(`${tag}: 問題IDが全体で重複しています`);
    globalQids.add(q.id);
    if (qids.has(q.id)) err(`${tag}: ファイル内でID重複`);
    qids.set(q.id, q);
    if (!q.id?.startsWith(`q-${uid}-`)) err(`${tag}: ID規則違反（q-${uid}-NNN 形式）`);
    if (!QTYPES.includes(q.type)) { err(`${tag}: type不正 "${q.type}"`); continue; }
    if (q.unitId !== uid) err(`${tag}: unitId不一致`);
    if (!q.stem?.trim()) err(`${tag}: stemが空`);
    if (!q.explanation?.trim()) err(`${tag}: explanationが空`);
    if (![1, 2, 3].includes(q.difficulty)) err(`${tag}: difficulty不正`);
    if (!Array.isArray(q.topics) || q.topics.length === 0) err(`${tag}: topicsが空`);
    else for (const t of q.topics) if (!topicIds.has(t)) err(`${tag}: 論点 "${t}" がtopics.jsonにありません`);
    if (q.srs === true) srsCount++;

    if (q.type === "journal") {
      const checkSide = (side, name, ctx) => {
        if (!Array.isArray(side) || side.length === 0) { err(`${ctx}: ${name}が空`); return 0; }
        let sum = 0;
        for (const line of side) {
          const acc = accountIds.get(line.acc);
          if (!acc) err(`${ctx}: 科目ID "${line.acc}" がaccounts.jsonにありません`);
          else if ((unitOrder.get(acc.introducedIn) ?? 999) > unitOrder.get(uid))
            err(`${ctx}: 科目 "${acc.name}" (${line.acc}) は ${acc.introducedIn} 導入で未学習`);
          if (!Number.isInteger(line.amt) || line.amt <= 0) err(`${ctx}: 金額不正 ${line.amt}`);
          else sum += line.amt;
        }
        return sum;
      };
      const answers = [q.answer, ...(q.answer?.alt || [])];
      answers.forEach((ans, i) => {
        const ctx = `${tag}${i > 0 ? ` alt[${i - 1}]` : ""}`;
        const d = checkSide(ans.dr, "借方", ctx);
        const c = checkSide(ans.cr, "貸方", ctx);
        if (d !== c) err(`${ctx}: 貸借不一致 借方${d} ≠ 貸方${c}`);
      });
    } else if (q.type === "mc") {
      if (!Array.isArray(q.choices) || q.choices.length < 3) err(`${tag}: choicesは3つ以上`);
      else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) err(`${tag}: answerインデックス不正`);
    } else if (q.type === "tf") {
      if (typeof q.answer !== "boolean") err(`${tag}: answerはtrue/false`);
    } else if (q.type === "fill_number") {
      if (typeof q.answer?.value !== "number") err(`${tag}: answer.valueが数値ではありません`);
    }
  }
  if (srsCount < 8 || srsCount > 15) warn(`${uid}: srs:true コアカードが${srsCount}問（推奨8〜15）`);

  // レッスン
  if (lesson.unitId !== uid) err(`lessons/${uid}: unitId不一致`);
  const secIds = new Set();
  const checkpointed = new Set();
  for (const sec of lesson.sections || []) {
    const tag = `lessons/${uid} ${sec.id}`;
    if (secIds.has(sec.id)) err(`${tag}: セクションID重複`);
    secIds.add(sec.id);
    if (!Array.isArray(sec.topics) || sec.topics.length === 0) warn(`${tag}: topicsが空`);
    else for (const t of sec.topics) if (!topicIds.has(t)) err(`${tag}: 論点 "${t}" がtopics.jsonにありません`);
    for (const b of sec.blocks || []) {
      if (!["text", "figure", "example"].includes(b.type)) err(`${tag}: block type不正 "${b.type}"`);
      if (b.type === "figure" && !FIGKINDS.includes(b.figure?.kind)) err(`${tag}: figure kind不正 "${b.figure?.kind}"`);
      if (b.type === "example" && !["worked", "partial", "full"].includes(b.fading)) err(`${tag}: fading不正 "${b.fading}"`);
    }
    if (!Array.isArray(sec.checkpoint) || sec.checkpoint.length < 2 || sec.checkpoint.length > 4)
      warn(`${tag}: チェックポイントは2〜4問推奨（現在${sec.checkpoint?.length ?? 0}）`);
    for (const cq of sec.checkpoint || []) {
      if (!qids.has(cq)) err(`${tag}: チェックポイント "${cq}" が questions/${uid}.json にありません`);
      checkpointed.add(cq);
    }
    // lessonRef 逆参照チェック用
  }
  const secCount = (lesson.sections || []).length;
  if (secCount < 3 || secCount > 6) warn(`${uid}: セクション数${secCount}（推奨3〜6）`);
  const qCount = (qdoc.questions || []).length;
  if (qCount < 15 || qCount > 45) warn(`${uid}: 問題数${qCount}（推奨15〜40）`);
  for (const q of qdoc.questions || []) {
    if (q.lessonRef && !secIds.has(q.lessonRef)) err(`questions/${uid} ${q.id}: lessonRef "${q.lessonRef}" がレッスンにありません`);
  }
}

report();

function report() {
  for (const w of warns) console.log(`⚠ ${w}`);
  if (errors.length === 0) {
    console.log(`✅ 検証OK（エラー0件、警告${warns.length}件）`);
    process.exit(0);
  } else {
    for (const e of errors) console.log(`✗ ${e}`);
    console.log(`❌ エラー${errors.length}件、警告${warns.length}件`);
    process.exit(1);
  }
}
