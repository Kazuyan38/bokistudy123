// quiz.js — 出題・採点エンジン（journal / mc / tf / fill_number）
// セッション種別: checkpoint | drill | review | test（DESIGN.md §1 が正本）

import { Store } from "./store.js";
import { rate } from "./srs.js";
import { esc, yen, renderFigure } from "./render/figures.js";

/* ============================== 画面内テンキー ============================== */

const numpadEl = () => document.getElementById("numpad");
let numpadTarget = null;
let numpadOnDone = null;

function openNumpad(input, { allowNegative = false, onDone = null } = {}) {
  numpadTarget = input;
  numpadOnDone = onDone;
  const el = numpadEl();
  const keys = [
    "7", "8", "9", "⌫",
    "4", "5", "6", "C",
    "1", "2", "3", allowNegative ? "±" : "00",
    "0", allowNegative ? "00" : "000", ",", "完了",
  ];
  el.innerHTML = `<div class="numpad-grid">${keys.map((k) =>
    `<button class="numpad-key ${k === "完了" ? "act" : ""}" data-k="${k}">${k}</button>`).join("")}</div>`;
  el.hidden = false;
  el.onclick = (e) => {
    const k = e.target.closest("[data-k]")?.dataset.k;
    if (!k || !numpadTarget) return;
    let raw = numpadTarget.dataset.raw || "";
    if (k === "完了") { closeNumpad(); return; }
    else if (k === "⌫") raw = raw.slice(0, -1);
    else if (k === "C") raw = "";
    else if (k === "±") raw = raw.startsWith("-") ? raw.slice(1) : "-" + raw;
    else if (k === ",") { /* 桁区切りは自動 */ }
    else if (/^\d+$/.test(k)) {
      if (raw.replace("-", "").length + k.length <= 12) raw += k;
    }
    numpadTarget.dataset.raw = raw;
    numpadTarget.value = raw === "" || raw === "-" ? raw : Number(raw).toLocaleString("ja-JP");
    numpadTarget.dispatchEvent(new Event("input"));
  };
}
export function closeNumpad() {
  const el = numpadEl();
  el.hidden = true;
  el.onclick = null;
  if (numpadOnDone) { const f = numpadOnDone; numpadOnDone = null; f(); }
  numpadTarget = null;
}

/* ============================== 科目パネル ============================== */

const CAT_LABELS = { asset: "資産", liability: "負債", equity: "純資産", revenue: "収益", expense: "費用", other: "その他" };

function openAccountSheet(accounts, onPick) {
  const cats = [...new Set(accounts.map((a) => a.cat))];
  let activeCat = cats[0];
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  const sheet = document.createElement("div");
  sheet.className = "acc-sheet";
  const render = () => {
    sheet.innerHTML = `
      <div class="acc-sheet-head"><span class="card-title">勘定科目を選ぶ</span></div>
      <div class="acc-tabs">${cats.map((c) =>
        `<button class="acc-tab ${c === activeCat ? "active" : ""}" data-cat="${c}">${CAT_LABELS[c]}</button>`).join("")}</div>
      <div class="acc-list">${accounts.filter((a) => a.cat === activeCat).map((a) =>
        `<button class="acc-chip" data-id="${a.id}">${esc(a.name)}</button>`).join("")}</div>`;
  };
  render();
  const close = () => { backdrop.remove(); sheet.remove(); };
  backdrop.onclick = close;
  sheet.onclick = (e) => {
    const tab = e.target.closest("[data-cat]");
    if (tab) { activeCat = tab.dataset.cat; render(); return; }
    const chip = e.target.closest("[data-id]");
    if (chip) { onPick(chip.dataset.id); close(); }
  };
  document.body.append(backdrop, sheet);
}

/* ============================== 採点 ============================== */

function parseAmount(input) {
  const raw = (input.dataset.raw ?? input.value ?? "").replace(/[,，円\s]/g, "").replace(/△/g, "-");
  if (raw === "" || raw === "-") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function sideKey(lines) {
  return lines.map((l) => `${l.acc}:${l.amt}`).sort().join("|");
}

export function gradeJournal(q, userDr, userCr) {
  const candidates = [q.answer, ...(q.answer.alt || [])];
  const uD = sideKey(userDr), uC = sideKey(userCr);
  return candidates.some((a) => sideKey(a.dr) === uD && sideKey(a.cr) === uC);
}

export function gradeFill(q, value) {
  if (value == null) return false;
  const tol = q.answer.tolerance ?? 0;
  return Math.abs(value - q.answer.value) <= tol;
}

/* ============================== 部品HTML ============================== */

const ICON_OK = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor" opacity=".15"/><path d="M7.5 12.5 10.5 15.5 16.5 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_NG = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor" opacity=".15"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;

function answerJournalFigure(q, app) {
  const nameOf = (id) => app.accountById(id)?.name || id;
  const rows = [{
    dr: q.answer.dr.map((l) => [nameOf(l.acc), l.amt]),
    cr: q.answer.cr.map((l) => [nameOf(l.acc), l.amt]),
  }];
  return `<div class="correct-journal">${renderFigure({ kind: "journal", rows, caption: "正解の仕訳" })}</div>`;
}

/* ============================== セッション ============================== */

/**
 * クイズセッションを実行する。
 * opts: { app, container, questions, mode, unitId, title, accounts, onFinish }
 *  mode: "checkpoint" | "drill" | "review" | "test"
 *  onFinish({ total, correct, wrongQids, aborted })
 */
export function runSession(opts) {
  const { app, container, questions, mode, title, accounts, onFinish } = opts;
  const queue = [...questions];
  const firstResult = new Map(); // qid -> boolean（初回解答のみ統計へ）
  let index = 0;

  const total = questions.length;
  const requeue = mode !== "test"; // テスト以外は誤答をセッション内再出題

  document.getElementById("calc-fab").hidden = false;

  function finish(aborted = false) {
    document.getElementById("calc-fab").hidden = true;
    closeNumpad();
    const correct = [...firstResult.values()].filter(Boolean).length;
    const wrongQids = [...firstResult.entries()].filter(([, ok]) => !ok).map(([qid]) => qid);
    onFinish({ total, correct, wrongQids, aborted });
  }

  function next() {
    if (index >= queue.length) return finish(false);
    renderQuestion(queue[index]);
  }

  function headerHTML(q) {
    const answeredCount = Math.min(firstResult.size + 1, total);
    const topic = q.topics?.[0] ? app.topicById(q.topics[0]) : null;
    return `<div class="quiz-top">
      <button class="btn-ghost btn btn-sm" data-act="quit">← 中断</button>
      <span class="quiz-count num">${answeredCount} / ${total}</span>
      ${topic ? `<span class="topic-chip">${esc(topic.name)}</span>` : "<span></span>"}
    </div>`;
  }

  function renderQuestion(q) {
    closeNumpad();
    container.innerHTML = `
      ${headerHTML(q)}
      ${title ? `<p class="muted" style="margin-bottom:8px">${esc(title)}</p>` : ""}
      <div class="card"><p class="quiz-stem">${esc(q.stem)}</p></div>
      <div id="q-input"></div>
      <div id="q-feedback"></div>`;
    container.querySelector('[data-act="quit"]').onclick = () => finish(true);
    const inputArea = container.querySelector("#q-input");

    if (q.type === "mc") renderMC(q, inputArea);
    else if (q.type === "tf") renderTF(q, inputArea);
    else if (q.type === "journal") renderJournal(q, inputArea);
    else if (q.type === "fill_number") renderFillNumber(q, inputArea);
  }

  /* ---- mc ---- */
  function renderMC(q, area) {
    let order = q.choices.map((_, i) => i);
    if (q.shuffle) order = order.sort(() => Math.random() - 0.5);
    area.innerHTML = `<div class="choices">${order.map((oi, pos) =>
      `<button class="choice-btn" data-oi="${oi}"><span class="cmark">${"アイウエオ"[pos]}</span>${esc(q.choices[oi])}</button>`).join("")}</div>`;
    area.querySelectorAll(".choice-btn").forEach((btn) => {
      btn.onclick = () => {
        const oi = Number(btn.dataset.oi);
        const correct = oi === q.answer;
        area.querySelectorAll(".choice-btn").forEach((b) => {
          b.disabled = true;
          if (Number(b.dataset.oi) === q.answer) b.classList.add("correct");
        });
        if (!correct) btn.classList.add("wrong");
        afterAnswer(q, correct);
      };
    });
  }

  /* ---- tf ---- */
  function renderTF(q, area) {
    area.innerHTML = `<div class="tf-row">
      <button class="tf-btn o" data-v="true">○</button>
      <button class="tf-btn x" data-v="false">×</button>
    </div>`;
    area.querySelectorAll(".tf-btn").forEach((btn) => {
      btn.onclick = () => {
        const v = btn.dataset.v === "true";
        const correct = v === q.answer;
        area.querySelectorAll(".tf-btn").forEach((b) => (b.disabled = true));
        btn.classList.add("sel");
        afterAnswer(q, correct);
      };
    });
  }

  /* ---- journal ---- */
  function renderJournal(q, area) {
    const state = { dr: [{ acc: null, amt: null }], cr: [{ acc: null, amt: null }] };

    const sideHTML = (side, label) => `
      <div class="j-side ${side}">
        <div class="j-side-label"><i></i>${label}</div>
        <div class="j-rows" data-side="${side}"></div>
        <button class="j-add" data-side="${side}">＋ 行を追加</button>
      </div>`;

    area.innerHTML = `<div class="journal-form">
      ${sideHTML("dr", "借方")}
      ${sideHTML("cr", "貸方")}
      <div class="j-diff" id="j-diff"></div>
      <button class="btn btn-primary btn-block" id="j-submit">解答する</button>
    </div>`;

    const renderRows = () => {
      for (const side of ["dr", "cr"]) {
        const wrap = area.querySelector(`.j-rows[data-side="${side}"]`);
        wrap.innerHTML = state[side].map((row, i) => `
          <div class="j-row">
            <button class="j-acc ${row.acc ? "filled" : ""}" data-side="${side}" data-i="${i}">
              ${row.acc ? esc(app.accountById(row.acc)?.name || row.acc) : "科目を選ぶ"}
            </button>
            <input class="j-amt" data-side="${side}" data-i="${i}" inputmode="none" readonly
              placeholder="金額" data-raw="${row.amt ?? ""}" value="${row.amt != null ? yen(row.amt) : ""}">
            ${state[side].length > 1 ? `<button class="j-del" data-side="${side}" data-i="${i}">✕</button>` : ""}
          </div>`).join("");
      }
      updateDiff();
      bindRows();
    };

    const updateDiff = () => {
      const sum = (side) => state[side].reduce((s, r) => s + (r.amt || 0), 0);
      const d = sum("dr"), c = sum("cr");
      const el = area.querySelector("#j-diff");
      el.textContent = `借方合計 ${yen(d)} ／ 貸方合計 ${yen(c)}`;
      el.className = "j-diff" + (d !== c && d + c > 0 ? " ng" : "");
    };

    const bindRows = () => {
      area.querySelectorAll(".j-acc").forEach((btn) => {
        btn.onclick = () => openAccountSheet(accounts, (id) => {
          state[btn.dataset.side][Number(btn.dataset.i)].acc = id;
          renderRows();
        });
      });
      area.querySelectorAll(".j-amt").forEach((inp) => {
        inp.onclick = () => openNumpad(inp);
        inp.oninput = () => {
          const n = parseAmount(inp);
          state[inp.dataset.side][Number(inp.dataset.i)].amt = n;
          updateDiff();
        };
      });
      area.querySelectorAll(".j-del").forEach((btn) => {
        btn.onclick = () => {
          state[btn.dataset.side].splice(Number(btn.dataset.i), 1);
          renderRows();
        };
      });
    };

    area.querySelectorAll(".j-add").forEach((btn) => {
      btn.onclick = () => {
        if (state[btn.dataset.side].length < 4) {
          state[btn.dataset.side].push({ acc: null, amt: null });
          renderRows();
        }
      };
    });

    area.querySelector("#j-submit").onclick = () => {
      closeNumpad();
      const clean = (side) => state[side].filter((r) => r.acc && r.amt != null && r.amt > 0);
      const dr = clean("dr"), cr = clean("cr");
      if (dr.length === 0 || cr.length === 0) {
        app.toast("借方・貸方の両方に科目と金額を入力してください");
        return;
      }
      const correct = gradeJournal(q, dr, cr);
      area.querySelectorAll("button, input").forEach((el) => (el.disabled = true));
      afterAnswer(q, correct, { showCorrectJournal: !correct });
    };

    renderRows();
  }

  /* ---- fill_number ---- */
  function renderFillNumber(q, area) {
    area.innerHTML = `
      <div class="fill-row">
        <input class="fill-input" inputmode="none" readonly placeholder="数値を入力" data-raw="">
        <span class="fill-unit">${esc(q.answer.unit || "")}</span>
      </div>
      <button class="btn btn-primary btn-block mt-16" id="f-submit">解答する</button>`;
    const inp = area.querySelector(".fill-input");
    inp.onclick = () => openNumpad(inp, { allowNegative: true });
    area.querySelector("#f-submit").onclick = () => {
      closeNumpad();
      const v = parseAmount(inp);
      if (v == null) { app.toast("数値を入力してください"); return; }
      const correct = gradeFill(q, v);
      area.querySelectorAll("button, input").forEach((el) => (el.disabled = true));
      afterAnswer(q, correct, { correctValue: `${yen(q.answer.value)}${q.answer.unit || ""}` });
    };
  }

  /* ---- 解答後の共通処理 ---- */
  function afterAnswer(q, correct, extra = {}) {
    const isFirst = !firstResult.has(q.id);
    if (isFirst) {
      firstResult.set(q.id, correct);
      Store.recordAnswer(q.id, q.topics, correct);
    }

    // SRS更新
    const card = Store.srsCard(q.id);
    const examDate = Store.profile.examDate;
    if (card && isFirst) {
      if (!correct) {
        Store.srsSet(q.id, rate(card, "again", examDate));
      } else if (mode !== "review") {
        Store.srsSet(q.id, rate(card, "good", examDate));
      }
      // review モードの正解は good/easy ボタンで確定（下記）
    }

    if (!correct && requeue && isFirst) queue.push(q);

    const fb = container.querySelector("#q-feedback");
    const showExplain = true; // 即時フィードバック原則: テストでも解説を表示する
    fb.innerHTML = `
      <div class="result-banner ${correct ? "ok" : "ng"}">
        ${correct ? ICON_OK : ICON_NG}<span>${correct ? "正解！" : "残念、不正解"}</span>
      </div>
      ${extra.showCorrectJournal ? answerJournalFigure(q, app) : ""}
      ${extra.correctValue && !correct ? `<p class="mt-8"><strong>正解: ${esc(extra.correctValue)}</strong></p>` : ""}
      ${showExplain ? `<div class="card mt-16 explain"><span class="explain-label">解説</span>${esc(q.explanation)}</div>` : ""}
      <div id="q-next"></div>`;

    const nextArea = fb.querySelector("#q-next");
    if (mode === "review" && correct && card) {
      nextArea.innerHTML = `<div class="srs-rate">
        <button class="btn btn-ghost" data-g="good">できた</button>
        <button class="btn btn-accent" data-g="easy">かんたん</button>
      </div>`;
      nextArea.querySelectorAll("[data-g]").forEach((btn) => {
        btn.onclick = () => {
          Store.srsSet(q.id, rate(Store.srsCard(q.id), btn.dataset.g, examDate));
          index++; next();
        };
      });
    } else {
      nextArea.innerHTML = `<button class="btn btn-primary btn-block mt-16" id="q-nextbtn">次へ</button>`;
      nextArea.querySelector("#q-nextbtn").onclick = () => { index++; next(); };
      nextArea.querySelector("#q-nextbtn").focus();
    }
    fb.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  next();
}

/* ============================== セット結果画面 ============================== */

export function renderSetResult(container, { title, correct, total, wrongQids, questionById, actions }) {
  const pct = total ? Math.round((correct / total) * 100) : 0;
  container.innerHTML = `
    <div class="set-result-hero">
      <p class="muted">${esc(title)}</p>
      <div class="big num">${pct}<small>%</small></div>
      <p class="muted num">${correct} / ${total} 問正解</p>
      <div id="seal"></div>
    </div>
    ${wrongQids.length ? `<div class="card wrong-list">
      <span class="card-title">間違えた問題</span>
      ${wrongQids.map((qid) => {
        const q = questionById(qid);
        return q ? `<div class="q-row"><strong>${esc(q.stem.slice(0, 42))}${q.stem.length > 42 ? "…" : ""}</strong><br><span class="muted">${esc(q.explanation.slice(0, 80))}…</span></div>` : "";
      }).join("")}
    </div>` : ""}
    <div id="result-actions"></div>`;
  const actArea = container.querySelector("#result-actions");
  for (const a of actions) {
    const btn = document.createElement("button");
    btn.className = `btn ${a.primary ? "btn-primary" : "btn-ghost"} btn-block mt-8`;
    btn.textContent = a.label;
    btn.onclick = a.onClick;
    actArea.append(btn);
  }
  return { sealEl: container.querySelector("#seal") };
}
