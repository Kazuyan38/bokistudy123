// srs.js — SM-2ライト間隔反復エンジン（DESIGN.md §1.2 が正本）

import { todayStr } from "./store.js";

const IVL_MAX = 45;
export const REVIEW_DAILY_LIMIT = 50;

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function capIvl(ivl, examDate) {
  let cap = IVL_MAX;
  if (examDate) {
    const days = Math.floor((new Date(examDate) - new Date(todayStr())) / 86400000) - 3;
    if (days > 0) cap = Math.min(cap, days);
  }
  return Math.max(1, Math.min(ivl, cap));
}

/**
 * カード評価。grade: "again" | "good" | "easy"
 * card: { ef, ivl, reps, lapses, due } を新しい状態で返す
 */
export function rate(card, grade, examDate = null) {
  const c = { ...card };
  const today = todayStr();
  if (grade === "again") {
    c.ef = Math.max(1.3, c.ef - 0.2);
    c.reps = 0;
    c.lapses += 1;
    c.ivl = 1;
    c.due = addDays(today, 1); // セッション内の再出題はクイズ側が担当
  } else if (grade === "good") {
    c.reps += 1;
    if (c.reps === 1) c.ivl = 1;
    else if (c.reps === 2) c.ivl = 3;
    else c.ivl = Math.round(c.ivl * c.ef);
    c.ivl = capIvl(c.ivl, examDate);
    c.due = addDays(today, c.ivl);
  } else if (grade === "easy") {
    c.reps += 1;
    c.ef = Math.min(2.8, c.ef + 0.05);
    if (c.reps === 1) c.ivl = 2;
    else if (c.reps === 2) c.ivl = 4;
    else c.ivl = Math.round(c.ivl * c.ef * 1.3);
    c.ivl = capIvl(c.ivl, examDate);
    c.due = addDays(today, c.ivl);
  }
  return c;
}

/**
 * 今日の復習キュー。期日到来カードを優先順に最大limit件返す。
 * 優先順: 超過日数 降順 → lapses 降順
 */
export function dueQueue(allCards, limit = REVIEW_DAILY_LIMIT) {
  const today = todayStr();
  return Object.entries(allCards)
    .filter(([, c]) => c.due <= today)
    .sort((a, b) => {
      const od = a[1].due.localeCompare(b[1].due);
      if (od !== 0) return od; // 期日が古い（超過大）順
      return b[1].lapses - a[1].lapses;
    })
    .slice(0, limit)
    .map(([qid]) => qid);
}

export function dueCount(allCards) {
  const today = todayStr();
  return Object.values(allCards).filter((c) => c.due <= today).length;
}

export function overdueCount(allCards) {
  const today = todayStr();
  return Object.values(allCards).filter((c) => c.due < today).length;
}
