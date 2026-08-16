// lesson.js — レッスン表示・チェックポイント・コアカード投入
// 構造: セクション本文 → チェックポイント（2〜4問）→ 次セクション。全完了でSRSコア投入

import { Store } from "./store.js";
import { mdLite, esc, renderFigure } from "./render/figures.js";
import { runSession } from "./quiz.js";

const FADING_LABEL = { worked: "例題（解き方つき）", partial: "例題（いっしょに解く）", full: "例題（自力で挑戦）" };

export function renderLesson(app, container, unitId, secIdx) {
  const lesson = app.lessons[unitId];
  const unit = app.unitById(unitId);
  if (!lesson) { container.innerHTML = `<p class="empty-note">レッスンが見つかりません</p>`; return; }

  const sections = lesson.sections;
  const idx = Math.max(0, Math.min(secIdx, sections.length - 1));
  const sec = sections[idx];
  const prog = Store.unit(unitId);

  const blocksHTML = sec.blocks.map((b) => {
    if (b.type === "text") return `<div class="lesson-body">${mdLite(b.md)}</div>`;
    if (b.type === "figure") return renderFigure(b.figure);
    if (b.type === "example") {
      return `<div class="example-block">
        <span class="example-tag">${FADING_LABEL[b.fading] || "例題"}</span>
        <div class="lesson-body">${mdLite(b.md)}</div>
      </div>`;
    }
    return "";
  }).join("");

  container.innerHTML = `
    <div class="lesson-head">
      <button class="btn btn-ghost btn-sm" id="back">← ${esc(unit.title)}</button>
      <div class="lesson-prog">${sections.map((s, i) =>
        `<i class="${prog.lessonDone.includes(s.id) || i < idx ? "done" : ""}"></i>`).join("")}</div>
      <p class="muted num">セクション ${idx + 1} / ${sections.length}</p>
      <h1 class="lesson-sec-title">${esc(sec.title)}</h1>
    </div>
    <div id="lesson-content">${blocksHTML}</div>
    <div id="lesson-foot" class="mt-24">
      <button class="btn btn-accent btn-block" id="to-checkpoint">
        チェックポイントへ（${sec.checkpoint.length}問）
      </button>
    </div>`;

  container.querySelector("#back").onclick = () => (location.hash = `#unit/${unitId}`);
  container.querySelector("#to-checkpoint").onclick = () => startCheckpoint(app, container, unitId, idx);
}

function startCheckpoint(app, container, unitId, idx) {
  const lesson = app.lessons[unitId];
  const sec = lesson.sections[idx];
  const questions = sec.checkpoint.map((qid) => app.questionById(qid)).filter(Boolean);

  runSession({
    app,
    container,
    questions,
    mode: "checkpoint",
    title: `チェックポイント — ${sec.title}`,
    accounts: app.accountsForUnit(unitId),
    onFinish: ({ aborted }) => {
      if (aborted) { renderLesson(app, container, unitId, idx); return; }
      completeSection(app, container, unitId, idx);
    },
  });
}

function completeSection(app, container, unitId, idx) {
  const lesson = app.lessons[unitId];
  const sections = lesson.sections;
  Store.markSectionDone(unitId, sections[idx].id);

  const done = Store.unit(unitId).lessonDone.length;
  const isLast = done >= sections.length;

  if (isLast && !Store.unit(unitId).srsIntroduced) {
    // レッスン全完了 → コアカードをSRSへ投入（テスト効果×間隔反復の起点）
    const cores = (app.questionsByUnit[unitId] || []).filter((q) => q.srs).map((q) => q.id);
    Store.srsIntroduce(cores);
    Store.markSrsIntroduced(unitId);
    app.celebrate({
      title: "レッスン完了！",
      body: `「${app.unitById(unitId).title}」の全セクションを学びました。コア問題${cores.length}問を復習カードに追加。次はドリルで定着させましょう。`,
      actions: [
        { label: "ドリルをはじめる", primary: true, hash: `#drill/unit-${unitId}` },
        { label: "単元ページへ", hash: `#unit/${unitId}` },
      ],
    });
  } else if (isLast) {
    location.hash = `#unit/${unitId}`;
  } else {
    location.hash = `#lesson/${unitId}/${idx + 1}`;
  }
}
