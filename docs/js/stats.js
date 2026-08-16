// stats.js — 分析画面（メタ認知支援: 進捗・弱点・カバレッジの可視化）

import { Store, todayStr } from "./store.js";
import { dueCount, overdueCount } from "./srs.js";
import { esc } from "./render/figures.js";

function accClass(acc, answered) {
  if (!answered) return "h-none";
  if (acc < 0.5) return "h-low";
  if (acc < 0.8) return "h-mid";
  return "h-high";
}

export function renderStats(app, container) {
  const days = Store.days();
  const streak = Store.streak();
  const cards = Store.srsAll();

  // 累計
  let totalAns = 0, totalCor = 0;
  for (const d of Object.values(days)) { totalAns += d.answered; totalCor += d.correct; }
  const totalAcc = totalAns ? Math.round((totalCor / totalAns) * 100) : 0;

  // 直近14日バー
  const barDays = [];
  let maxA = 1;
  for (let i = 13; i >= 0; i--) {
    const ds = todayStr(-i);
    const d = days[ds] || { answered: 0 };
    maxA = Math.max(maxA, d.answered);
    barDays.push({ ds, n: d.answered, today: i === 0 });
  }

  // 単元別習熟（出題実績のある問題の正答率）
  const qStats = Store.questionStats();
  const unitAgg = {};
  for (const [qid, s] of Object.entries(qStats)) {
    const q = app.questionById(qid);
    if (!q) continue;
    unitAgg[q.unitId] = unitAgg[q.unitId] || { a: 0, c: 0 };
    unitAgg[q.unitId].a += s.attempts;
    unitAgg[q.unitId].c += s.correct;
  }

  // 論点カバレッジ
  const tStats = Store.topicStats();
  const topicCells = app.topics.map((t) => {
    const s = tStats[t.id];
    const acc = s ? s.correct / s.answered : 0;
    return { ...t, answered: s?.answered || 0, acc };
  });
  const weak = topicCells.filter((t) => t.answered >= 4).sort((a, b) => a.acc - b.acc).slice(0, 5);

  container.innerHTML = `
    <h1 class="page-title">分析</h1>

    <div class="stat-grid">
      <div class="stat-tile"><div class="v num">${streak.current}<small>日</small></div><div class="k">連続学習（最高 ${streak.best}日）</div></div>
      <div class="stat-tile"><div class="v num">${Store.todayCount()}<small> / ${Store.profile.dailyGoal}問</small></div><div class="k">今日の学習量</div></div>
      <div class="stat-tile"><div class="v num">${totalAns.toLocaleString()}<small>問</small></div><div class="k">累計解答数（正答率 ${totalAcc}%）</div></div>
      <div class="stat-tile"><div class="v num">${dueCount(cards)}<small>枚</small></div><div class="k">今日の復習カード${overdueCount(cards) ? `（期日超過 ${overdueCount(cards)}）` : ""}</div></div>
    </div>

    <div class="card">
      <span class="card-title">直近14日の学習量</span>
      <div class="bar-chart">${barDays.map((b) => `
        <div class="bar-col ${b.today ? "today" : ""}">
          <i style="height:${Math.round((b.n / maxA) * 100)}%"></i>
          <span>${Number(b.ds.slice(8))}</span>
        </div>`).join("")}
      </div>
    </div>

    <div class="card">
      <span class="card-title">単元別の習熟</span>
      <div class="heat-grid">${app.availableUnits().map((u) => {
        const s = unitAgg[u.id];
        const acc = s ? s.c / s.a : 0;
        return `<div class="heat-cell ${accClass(acc, s?.a)}">
          ${esc(u.title)}<span class="pct num">${s ? Math.round(acc * 100) + "%" : "未演習"}</span>
        </div>`;
      }).join("")}</div>
      <p class="muted mt-8">緑=80%以上 ／ 黄=50〜79% ／ 赤=50%未満</p>
    </div>

    <div class="card">
      <span class="card-title">論点カバレッジマップ</span>
      <div class="heat-grid">${topicCells.map((t) => `
        <div class="heat-cell ${accClass(t.acc, t.answered)}">
          ${esc(t.name)}<span class="pct num">${t.answered ? Math.round(t.acc * 100) + "%" : "未演習"}</span>
        </div>`).join("")}</div>
      <p class="muted mt-8">「未演習」をゼロにし、全マスを緑にするのが目標です。弱点ドリルは赤・未演習の論点を優先的に出題します。</p>
    </div>

    ${weak.length ? `<div class="card">
      <span class="card-title">弱点論点 Top${weak.length}</span>
      ${weak.map((t) => `<div class="setting-row"><label>${esc(t.name)}</label><span class="num" style="color:var(--c-ng);font-weight:700">${Math.round(t.acc * 100)}%</span></div>`).join("")}
      <button class="btn btn-accent btn-block mt-16" id="weak-drill">弱点ドリルをはじめる</button>
    </div>` : ""}
  `;

  container.querySelector("#weak-drill")?.addEventListener("click", () => (location.hash = "#drill/mix"));
}
