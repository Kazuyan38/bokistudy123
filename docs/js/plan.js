// plan.js — 目標受験日から逆算する学習計画（GO判定条件はDESIGN.md §2が正本）

import { Store, todayStr } from "./store.js";
import { overdueCount } from "./srs.js";

const MOCK_WINDOW = 3;      // GO判定は直近何回の模試を見るか
const MIN_BUFFER_DAYS = 14; // 模試周回・最終見直しに最低限確保する日数

const DEFAULT_DAILY_GOAL = 20; // 目標受験日が未設定のときの既定値
const MIN_DAILY_GOAL = 10;
const MAX_DAILY_GOAL = 60;

function daysBetween(fromStr, toStr) {
  return Math.round((new Date(toStr) - new Date(fromStr)) / 86400000);
}

function sectionEarned(result, no) {
  return result.sections.find((s) => s.no === no)?.earned ?? 0;
}

function evalMockReadiness(results, srsOverdue) {
  const recent = results.slice(-MOCK_WINDOW);
  const reasons = [];

  if (recent.length < MOCK_WINDOW) {
    reasons.push(`模試の受験回数があと${MOCK_WINDOW - recent.length}回必要です（直近${MOCK_WINDOW}回で判定）`);
  } else {
    const failing = recent.filter((r) => r.pct < 75).length;
    if (failing) reasons.push(`直近${MOCK_WINDOW}回のうち${failing}回が75点未満です`);

    const avgPct = recent.reduce((s, r) => s + r.pct, 0) / recent.length;
    if (avgPct < 80) reasons.push(`直近${MOCK_WINDOW}回の平均が${Math.round(avgPct)}点です（80点以上が必要）`);

    const avgSec1 = recent.reduce((s, r) => s + sectionEarned(r, 1), 0) / recent.length;
    if (avgSec1 < 16) reasons.push(`第1問（仕訳）の平均が${avgSec1.toFixed(1)}点です（16/20点以上が必要）`);

    const avgIndustrial = recent.reduce((s, r) => s + sectionEarned(r, 4) + sectionEarned(r, 5), 0) / recent.length;
    if (avgIndustrial < 28) reasons.push(`工業簿記（第4・5問）の平均が${avgIndustrial.toFixed(1)}点です（28/40点以上が必要）`);
  }

  if (srsOverdue > 0) reasons.push(`復習期日超過のカードが${srsOverdue}枚あります`);

  return { ready: reasons.length === 0, reasons, attempts: results.length, recentCount: recent.length };
}

/**
 * 目標受験日から逆算した学習計画を返す。examDate未設定ならnull。
 */
export function computePlan(app) {
  const examDate = Store.profile.examDate;
  if (!examDate) return null;

  const today = todayStr();
  const daysLeft = daysBetween(today, examDate);

  const units = app.availableUnits();
  const unitsTotal = units.length;
  const unitsPassed = units.filter((u) => Store.isPassed(u.id)).length;
  const unitsRemaining = unitsTotal - unitsPassed;

  const bufferDays = Math.max(MIN_BUFFER_DAYS, Math.round(Math.max(daysLeft, 0) * 0.2));
  const unitDeadlineDays = Math.max(0, daysLeft - bufferDays);
  const requiredPacePerWeek = unitsRemaining > 0
    ? unitsRemaining / Math.max(unitDeadlineDays / 7, 1 / 7)
    : 0;

  // 実績ペース: 直近28日間に合格した単元数から算出
  const passedInfo = Store.passedUnitsInfo().filter((p) => p.passedAt);
  const recentPassed = passedInfo.filter((p) => daysBetween(p.passedAt, today) <= 28);
  const actualPacePerWeek = passedInfo.length >= 2 ? (recentPassed.length / 4) : null;

  let paceStatus;
  if (unitsRemaining === 0) paceStatus = "complete";
  else if (unitDeadlineDays <= 0) paceStatus = "urgent";
  else if (actualPacePerWeek == null) paceStatus = "unknown";
  else if (actualPacePerWeek >= requiredPacePerWeek * 0.95) paceStatus = "onTrack";
  else if (actualPacePerWeek >= requiredPacePerWeek * 0.6) paceStatus = "behind";
  else paceStatus = "urgent";

  const srsOverdue = overdueCount(Store.srsAll());
  const mock = evalMockReadiness(Store.mockResults(), srsOverdue);

  let overallStatus;
  if (mock.ready) overallStatus = "go";
  else if (daysLeft < 0) overallStatus = "overdue";
  else if (unitsRemaining === 0) overallStatus = "mockPhase";
  else if (paceStatus === "urgent") overallStatus = "urgent";
  else if (paceStatus === "behind") overallStatus = "behind";
  else if (paceStatus === "unknown") overallStatus = "starting";
  else overallStatus = "onTrack";

  return {
    examDate, daysLeft,
    unitsTotal, unitsPassed, unitsRemaining,
    bufferDays, unitDeadlineDays,
    requiredPacePerWeek, actualPacePerWeek, paceStatus,
    mock, overallStatus,
  };
}

/**
 * 目標受験日から逆算した「1日に解くべき問題数」の目安。
 * ユーザーが手入力する代わりに、残り単元の問題数を残り日数で割って算出する。
 */
export function recommendedDailyGoal(app) {
  const plan = computePlan(app);
  if (!plan) return DEFAULT_DAILY_GOAL;
  if (plan.unitsRemaining === 0) return MIN_DAILY_GOAL + 5; // 模試・復習中心フェーズは控えめに

  const remainingQuestions = app.availableUnits()
    .filter((u) => !Store.isPassed(u.id))
    .reduce((sum, u) => sum + (app.questionsByUnit[u.id]?.length || 0), 0);
  if (!remainingQuestions) return DEFAULT_DAILY_GOAL;

  const days = Math.max(plan.unitDeadlineDays, 1);
  const raw = Math.ceil(remainingQuestions / days);
  return Math.min(MAX_DAILY_GOAL, Math.max(MIN_DAILY_GOAL, raw));
}

export function planStatusLabel(status) {
  switch (status) {
    case "go": return { label: "GO判定クリア", cls: "go" };
    case "overdue": return { label: "目標日を過ぎています", cls: "overdue" };
    case "mockPhase": return { label: "単元完了・模試仕上げ中", cls: "mockPhase" };
    case "urgent": return { label: "ペースが大幅に遅れ気味", cls: "urgent" };
    case "behind": return { label: "ペースがやや遅れ気味", cls: "behind" };
    case "onTrack": return { label: "順調なペースです", cls: "onTrack" };
    case "starting": return { label: "学習を始めましょう", cls: "starting" };
    default: return { label: "", cls: "" };
  }
}

function planSummaryLine(plan) {
  if (plan.mock.ready) return "GO判定の条件を満たしています。あとは受験を申し込みましょう";
  if (plan.overallStatus === "urgent") return "このペースでは目標日までに間に合わない可能性があります";
  if (plan.overallStatus === "behind") return "少しペースを上げると目標日に間に合いそうです";
  if (plan.overallStatus === "mockPhase") return "単元学習は完了。模試を重ねてGO判定を目指しましょう";
  if (plan.overallStatus === "overdue") return "目標日を過ぎています。新しい目標日を設定しましょう";
  if (plan.overallStatus === "starting") return "まずは単元を進めてペースを掴みましょう";
  return "このペースを維持すれば目標日に間に合います";
}

/** 学習計画カードのHTML断片。compact:trueでホーム用の簡易表示。 */
export function renderPlanCard(plan, { compact = false } = {}) {
  if (!plan) return "";
  const { label, cls } = planStatusLabel(plan.overallStatus);
  const daysText = plan.daysLeft >= 0 ? `残り${plan.daysLeft}日` : `${Math.abs(plan.daysLeft)}日超過`;

  if (compact) {
    return `<a href="#stats" class="card card-tappable plan-card" style="display:block">
      <span class="plan-badge ${cls}">${label}</span>
      <div class="card-title">目標受験日 ${plan.examDate}（${daysText}）</div>
      <div class="card-sub">${planSummaryLine(plan)}</div>
    </a>`;
  }

  const paceText = plan.unitsRemaining === 0
    ? "全単元が学習済みです。あとは模試の仕上げに集中しましょう。"
    : plan.actualPacePerWeek == null
      ? `残り${plan.unitsRemaining}単元／${plan.unitsTotal}単元。週あたり${plan.requiredPacePerWeek.toFixed(1)}単元のペースが目安です（実績データが2件未満のため比較はまだ表示できません）`
      : `残り${plan.unitsRemaining}単元／${plan.unitsTotal}単元。必要ペースは週${plan.requiredPacePerWeek.toFixed(1)}単元、直近の実績ペースは週${plan.actualPacePerWeek.toFixed(1)}単元です`;

  return `<div class="card plan-card">
    <span class="plan-badge ${cls}">${label}</span>
    <div class="card-title">目標受験日 ${plan.examDate}（${daysText}）</div>
    <p class="card-sub mt-8">${paceText}</p>
    <p class="card-sub mt-8">模試GO判定: 直近${plan.mock.recentCount}回で判定${plan.mock.ready ? "・条件クリア済み" : ""}（受験実績 計${plan.mock.attempts}回）</p>
    ${plan.mock.reasons.length ? `<ul class="plan-reasons">${plan.mock.reasons.map((r) => `<li>${r}</li>`).join("")}</ul>` : ""}
  </div>`;
}
