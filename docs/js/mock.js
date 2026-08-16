// mock.js — 2級CBT形式模試モード（DESIGN.md §4.7 が正本）
// 通常のドリル/テストと異なり、非線形ナビゲーション・即時フィードバックなし・
// タイマー・大問別採点を持つ。quiz.jsの入力部品（科目パネル・テンキー・採点関数）を再利用する。

import { Store, todayStr } from "./store.js";
import { openAccountSheet, openNumpad, closeNumpad, gradeJournal, gradeFill, parseAmount } from "./quiz.js";
import { esc, yen } from "./render/figures.js";

let state = null; // { mock, secIdx, qIdx, answers:Map, flags:Set, remainingSec, timerId }
let appRef = null;

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/* ============================== 模試一覧 ============================== */

export async function renderMockList(app, container) {
  appRef = app;
  container.innerHTML = `<div class="spin"></div>`;
  let idx;
  try {
    idx = await loadJson("data/mocks/index.json");
  } catch (e) {
    container.innerHTML = `<p class="empty-note">模試データの読み込みに失敗しました</p>`;
    return;
  }
  const results = Store.mockResults();
  container.innerHTML = `
    <h1 class="page-title">2級模試</h1>
    <p class="muted">90分・100点満点（第1問仕訳20/第2問20/第3問20/第4問28/第5問12）。GO判定基準はDESIGN.md参照。</p>
    ${idx.mocks.map((m) => {
      const attempts = results.filter((r) => r.mockId === m.id);
      const best = attempts.length ? Math.max(...attempts.map((r) => r.pct)) : null;
      const available = m.status === "available";
      const inner = `
        <div class="card-title">${esc(m.title)}</div>
        <div class="card-sub">${m.timeLimitMin}分 / ${m.passScore}点以上で合格ライン${best != null ? ` ・ 自己ベスト <strong class="num">${best}%</strong>` : ""}</div>`;
      return available
        ? `<a href="#mock-intro/${m.id}" class="card card-tappable" style="display:block">${inner}</a>`
        : `<div class="card" style="opacity:.5">${inner}<div class="muted mt-8">近日追加</div></div>`;
    }).join("")}
  `;
}

/* ============================== 模試イントロ ============================== */

export async function renderMockIntro(app, container, mockId) {
  appRef = app;
  container.innerHTML = `<div class="spin"></div>`;
  let mock, idx;
  try {
    [mock, idx] = await Promise.all([loadJson(`data/mocks/${mockId}.json`), loadJson("data/mocks/index.json")]);
  } catch (e) {
    container.innerHTML = `<p class="empty-note">模試データの読み込みに失敗しました</p>`;
    return;
  }
  const title = idx.mocks.find((m) => m.id === mockId)?.title || mock.id;
  container.innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="location.hash='#mocks'">← 模試一覧</button>
    <h1 class="page-title mt-16">${esc(title)}</h1>
    <div class="card">
      <span class="card-title">出題構成</span>
      <div class="mt-8">${mock.sections.map((s) =>
        `<div class="setting-row"><label>${esc(s.label)}</label><span class="num">${s.points}点</span></div>`).join("")}</div>
      <div class="setting-row"><label><strong>制限時間</strong></label><span class="num">${mock.timeLimitMin}分</span></div>
      <div class="setting-row"><label><strong>合格ライン</strong></label><span class="num">${mock.passScore}点</span></div>
    </div>
    <p class="muted">開始すると自動でタイマーが進みます。途中で中断しても記録は保存されません。時間になると自動的に採点されます。</p>
    <button class="btn btn-accent btn-block mt-16" id="start">模試を開始する</button>`;

  container.querySelector("#start").onclick = () => startMock(app, container, mock, title);
}

/* ============================== 模試本体 ============================== */

function startMock(app, container, mock, title) {
  const flat = mock.sections.flatMap((s, si) => s.questions.map((q, qi) => ({ ...q, si, qi })));
  state = {
    mock,
    title,
    flat,
    secIdx: 0,
    qIdx: 0,
    answers: new Map(),
    flags: new Set(),
    remainingSec: mock.timeLimitMin * 60,
    timerId: null,
  };
  document.getElementById("calc-fab").hidden = false;
  state.timerId = setInterval(() => tick(app, container), 1000);
  renderMockScreen(app, container);
}

function tick(app, container) {
  if (!state) return;
  state.remainingSec--;
  const el = document.getElementById("mock-timer");
  if (el) {
    el.textContent = fmtTime(state.remainingSec);
    el.classList.toggle("ng", state.remainingSec <= 300);
  }
  if (state.remainingSec <= 0) {
    clearInterval(state.timerId);
    finishMock(app, container, true);
  }
}

function fmtTime(sec) {
  const m = Math.max(0, Math.floor(sec / 60));
  const s = Math.max(0, sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function currentQ() {
  const sec = state.mock.sections[state.secIdx];
  return sec.questions[state.qIdx];
}

function renderMockScreen(app, container) {
  closeNumpad();
  const sec = state.mock.sections[state.secIdx];
  const q = currentQ();
  const qid = q.id;
  const answered = state.answers.has(qid);
  const flagged = state.flags.has(qid);

  container.innerHTML = `
    <div class="mock-head">
      <div class="mock-timer-row">
        <span id="mock-timer" class="mock-timer num ${state.remainingSec <= 300 ? "ng" : ""}">${fmtTime(state.remainingSec)}</span>
        <button class="btn btn-ghost btn-sm" id="mock-submit">提出する</button>
      </div>
      <div class="mock-sec-tabs">${state.mock.sections.map((s, i) =>
        `<button class="mock-sec-tab ${i === state.secIdx ? "active" : ""}" data-si="${i}">${s.label.replace(/第\d問\s*/, "")}</button>`).join("")}</div>
      <div class="mock-q-nav">${sec.questions.map((qq, i) =>
        `<button class="mock-q-dot ${i === state.qIdx ? "cur" : ""} ${state.answers.has(qq.id) ? "done" : ""} ${state.flags.has(qq.id) ? "flag" : ""}" data-qi="${i}">${i + 1}</button>`).join("")}</div>
    </div>
    <div class="card">
      <div class="quiz-top">
        <span class="quiz-count num">${sec.label} — 問${state.qIdx + 1}/${sec.questions.length}</span>
        <button class="btn-ghost btn btn-sm ${flagged ? "" : ""}" id="mock-flag" style="${flagged ? "color:var(--c-accent)" : ""}">${flagged ? "★ 見直し" : "☆ 見直しに追加"}</button>
      </div>
      <p class="quiz-stem">${esc(q.stem)}</p>
    </div>
    <div id="mock-input"></div>
    <div class="mock-nav-btns">
      <button class="btn btn-ghost" id="mock-prev" ${state.secIdx === 0 && state.qIdx === 0 ? "disabled" : ""}>← 前へ</button>
      <button class="btn btn-primary" id="mock-next">次へ →</button>
    </div>`;

  renderInput(container.querySelector("#mock-input"), q);

  container.querySelector("#mock-flag").onclick = () => {
    if (flagged) state.flags.delete(qid); else state.flags.add(qid);
    renderMockScreen(app, container);
  };
  container.querySelectorAll("[data-si]").forEach((btn) => {
    btn.onclick = () => { state.secIdx = Number(btn.dataset.si); state.qIdx = 0; renderMockScreen(app, container); };
  });
  container.querySelectorAll("[data-qi]").forEach((btn) => {
    btn.onclick = () => { state.qIdx = Number(btn.dataset.qi); renderMockScreen(app, container); };
  });
  container.querySelector("#mock-prev").onclick = () => {
    if (state.qIdx > 0) state.qIdx--;
    else if (state.secIdx > 0) { state.secIdx--; state.qIdx = state.mock.sections[state.secIdx].questions.length - 1; }
    renderMockScreen(app, container);
  };
  container.querySelector("#mock-next").onclick = () => {
    if (state.qIdx < sec.questions.length - 1) state.qIdx++;
    else if (state.secIdx < state.mock.sections.length - 1) { state.secIdx++; state.qIdx = 0; }
    renderMockScreen(app, container);
  };
  container.querySelector("#mock-submit").onclick = () => {
    const total = state.flat.length;
    const done = state.answers.size;
    if (done < total && !confirm(`未回答が${total - done}問あります。このまま提出しますか？`)) return;
    clearInterval(state.timerId);
    finishMock(app, container, false);
  };
}

function saveAnswer(qid, data) {
  state.answers.set(qid, data);
}

function renderInput(area, q) {
  const prev = state.answers.get(q.id);
  if (q.type === "mc") return renderMcInput(area, q, prev);
  if (q.type === "tf") return renderTfInput(area, q, prev);
  if (q.type === "journal") return renderJournalInput(area, q, prev);
  if (q.type === "fill_number") return renderFillInput(area, q, prev);
}

function renderMcInput(area, q, prev) {
  let order = q.choices.map((_, i) => i);
  area.innerHTML = `<div class="choices">${order.map((oi, pos) =>
    `<button class="choice-btn ${prev?.oi === oi ? "sel" : ""}" data-oi="${oi}"><span class="cmark">${"アイウエオ"[pos]}</span>${esc(q.choices[oi])}</button>`).join("")}</div>`;
  area.querySelectorAll(".choice-btn").forEach((btn) => {
    btn.onclick = () => {
      saveAnswer(q.id, { oi: Number(btn.dataset.oi) });
      area.querySelectorAll(".choice-btn").forEach((b) => b.classList.toggle("sel", b === btn));
    };
  });
}

function renderTfInput(area, q, prev) {
  area.innerHTML = `<div class="tf-row">
    <button class="tf-btn o ${prev?.v === true ? "sel" : ""}" data-v="true">○</button>
    <button class="tf-btn x ${prev?.v === false ? "sel" : ""}" data-v="false">×</button>
  </div>`;
  area.querySelectorAll(".tf-btn").forEach((btn) => {
    btn.onclick = () => {
      saveAnswer(q.id, { v: btn.dataset.v === "true" });
      area.querySelectorAll(".tf-btn").forEach((b) => b.classList.toggle("sel", b === btn));
    };
  });
}

function renderFillInput(area, q, prev) {
  area.innerHTML = `
    <div class="fill-row">
      <input class="fill-input" inputmode="none" readonly placeholder="数値を入力" data-raw="${prev?.value ?? ""}" value="${prev?.value != null ? yen(prev.value) : ""}">
      <span class="fill-unit">${esc(q.answer.unit || "")}</span>
    </div>`;
  const inp = area.querySelector(".fill-input");
  inp.onclick = () => openNumpad(inp, { allowNegative: true, onDone: () => { const v = parseAmount(inp); saveAnswer(q.id, { value: v }); } });
}

function renderJournalInput(area, q, prev) {
  const accounts = appRef.accountsForUnit(q.unitId || "s2-u14");
  const st = prev?.state || { dr: [{ acc: null, amt: null }], cr: [{ acc: null, amt: null }] };

  const sideHTML = (side, label) => `
    <div class="j-side ${side}">
      <div class="j-side-label"><i></i>${label}</div>
      <div class="j-rows" data-side="${side}"></div>
      <button class="j-add" data-side="${side}">＋ 行を追加</button>
    </div>`;
  area.innerHTML = `<div class="journal-form">${sideHTML("dr", "借方")}${sideHTML("cr", "貸方")}</div>`;

  const persist = () => saveAnswer(q.id, { state: st });

  const renderRows = () => {
    for (const side of ["dr", "cr"]) {
      const wrap = area.querySelector(`.j-rows[data-side="${side}"]`);
      wrap.innerHTML = st[side].map((row, i) => `
        <div class="j-row">
          <button class="j-acc ${row.acc ? "filled" : ""}" data-side="${side}" data-i="${i}">
            ${row.acc ? esc(appRef.accountById(row.acc)?.name || row.acc) : "科目を選ぶ"}
          </button>
          <input class="j-amt" data-side="${side}" data-i="${i}" inputmode="none" readonly
            placeholder="金額" data-raw="${row.amt ?? ""}" value="${row.amt != null ? yen(row.amt) : ""}">
          ${st[side].length > 1 ? `<button class="j-del" data-side="${side}" data-i="${i}">✕</button>` : ""}
        </div>`).join("");
    }
    bind();
  };
  const bind = () => {
    area.querySelectorAll(".j-acc").forEach((btn) => {
      btn.onclick = () => openAccountSheet(accounts, (id) => { st[btn.dataset.side][Number(btn.dataset.i)].acc = id; persist(); renderRows(); });
    });
    area.querySelectorAll(".j-amt").forEach((inp) => {
      inp.onclick = () => openNumpad(inp, { onDone: () => { st[inp.dataset.side][Number(inp.dataset.i)].amt = parseAmount(inp); persist(); } });
    });
    area.querySelectorAll(".j-del").forEach((btn) => {
      btn.onclick = () => { st[btn.dataset.side].splice(Number(btn.dataset.i), 1); persist(); renderRows(); };
    });
    area.querySelectorAll(".j-add").forEach((btn) => {
      btn.onclick = () => { if (st[btn.dataset.side].length < 4) { st[btn.dataset.side].push({ acc: null, amt: null }); persist(); renderRows(); } };
    });
  };
  renderRows();
  persist();
}

/* ============================== 採点・結果 ============================== */

function gradeOne(q, ans) {
  if (!ans) return false;
  if (q.type === "mc") return ans.oi === q.answer;
  if (q.type === "tf") return ans.v === q.answer;
  if (q.type === "fill_number") return gradeFill(q, ans.value);
  if (q.type === "journal") {
    const clean = (side) => (ans.state?.[side] || []).filter((r) => r.acc && r.amt != null && r.amt > 0);
    const dr = clean("dr"), cr = clean("cr");
    if (!dr.length || !cr.length) return false;
    return gradeJournal(q, dr, cr);
  }
  return false;
}

function finishMock(app, container, timedOut) {
  document.getElementById("calc-fab").hidden = true;
  closeNumpad();
  const { mock, title } = state;
  const sectionResults = mock.sections.map((sec) => {
    let earned = 0, total = 0;
    const items = sec.questions.map((q) => {
      const correct = gradeOne(q, state.answers.get(q.id));
      total += q.pts;
      if (correct) earned += q.pts;
      return { id: q.id, correct, pts: q.pts };
    });
    return { no: sec.no, label: sec.label, earned, total, items };
  });
  const earned = sectionResults.reduce((s, r) => s + r.earned, 0);
  const total = sectionResults.reduce((s, r) => s + r.total, 0);
  const pct = Math.round((earned / total) * 100);
  const pass = earned >= mock.passScore;

  Store.recordMock({ mockId: mock.id, date: todayStr(), earned, total, pct, pass, sections: sectionResults.map((r) => ({ no: r.no, label: r.label, earned: r.earned, total: r.total })) });

  container.innerHTML = `
    <div class="set-result-hero">
      <p class="muted">${esc(title || mock.id)}${timedOut ? "（時間切れで自動提出）" : ""}</p>
      <div class="big num">${earned}<small> / ${total}点</small></div>
      <p class="muted num">正答率 ${pct}%</p>
      ${pass ? `<div class="pass-seal">合格ライン到達 ✓</div>` : `<p class="mt-8" style="color:var(--c-ng);font-weight:700">合格ラインまであと${mock.passScore - earned}点</p>`}
    </div>
    <div class="card">
      <span class="card-title">大問別スコア</span>
      ${sectionResults.map((r) => `<div class="setting-row"><label>${esc(r.label)}</label><span class="num">${r.earned} / ${r.total}点</span></div>`).join("")}
    </div>
    <button class="btn btn-primary btn-block mt-16" onclick="location.hash='#mocks'">模試一覧へ</button>`;

  state = null;
}
