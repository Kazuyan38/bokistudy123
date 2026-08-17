// ref.js — 重要事項集（検索）と単語テスト（エンドレス）
// keypoints.json を正本とし、単語テストは重要事項＋勘定科目分類から無限に出題する

import { Store } from "./store.js";
import { esc } from "./render/figures.js";

let kpCache = null;
async function loadKeypoints() {
  if (kpCache) return kpCache;
  const res = await fetch("data/keypoints.json");
  if (!res.ok) throw new Error(`keypoints.json: HTTP ${res.status}`);
  kpCache = (await res.json()).points;
  return kpCache;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ============================== 重要事項集 ============================== */

export async function renderRef(app, container) {
  container.innerHTML = `<div class="spin"></div>`;
  let points;
  try {
    points = await loadKeypoints();
  } catch (e) {
    container.innerHTML = `<p class="empty-note">重要事項集の読み込みに失敗しました</p>`;
    return;
  }
  const unitTitle = (id) => app.unitById(id)?.title || id;

  container.innerHTML = `
    <h1 class="page-title">重要事項集</h1>
    <input type="search" id="kp-q" class="search-input" placeholder="キーワードで検索（例: 貸倒引当金、為替予約）" autocomplete="off">
    <p class="muted mb-8"><span id="kp-count" class="num">${points.length}</span>件</p>
    <div id="kp-list"></div>
    <button class="btn btn-accent btn-block mt-16" onclick="location.hash='#vocab'">単語テストに挑戦する</button>`;

  const list = container.querySelector("#kp-list");
  const countEl = container.querySelector("#kp-count");
  const render = (q) => {
    const needle = q.trim().toLowerCase();
    const hits = needle
      ? points.filter((p) => `${p.title}${p.body}${unitTitle(p.unitId)}`.toLowerCase().includes(needle))
      : points;
    countEl.textContent = hits.length;
    list.innerHTML = hits.length
      ? hits.map((p) => `
        <div class="card kp-item">
          <span class="kp-unit">${esc(unitTitle(p.unitId))}</span>
          <div class="kp-title">${esc(p.title)}</div>
          <p class="kp-body">${esc(p.body)}</p>
        </div>`).join("")
      : `<p class="empty-note">「${esc(q)}」に一致する項目はありません</p>`;
  };
  render("");
  container.querySelector("#kp-q").oninput = (e) => render(e.target.value);
}

/* ============================== 単語テスト（エンドレス） ============================== */

const CAT_NAMES = { asset: "資産", liability: "負債", equity: "純資産", revenue: "収益", expense: "費用" };

function makeKeypointQ(points, recent) {
  const pool = points.filter((p) => !recent.includes(`kp:${p.id}`));
  const p = pool[Math.floor(Math.random() * pool.length)] || points[0];
  const stage = p.unitId.slice(0, 2);
  const sameStage = points.filter((x) => x.id !== p.id && x.unitId.startsWith(stage));
  const others = points.filter((x) => x.id !== p.id);
  const distractors = shuffle(sameStage.length >= 3 ? sameStage : others).slice(0, 3);
  const choices = shuffle([{ text: p.body, ok: true }, ...distractors.map((d) => ({ text: d.body, ok: false }))]);
  return {
    key: `kp:${p.id}`, qid: `v-${p.id}`,
    stem: `「${p.title}」の説明として正しいものはどれですか。`,
    choices, explanation: p.body,
  };
}

function makeAccountQ(accounts, recent) {
  const pool = accounts.filter((a) => CAT_NAMES[a.cat] && !recent.includes(`acc:${a.id}`));
  const a = pool[Math.floor(Math.random() * pool.length)] || accounts.find((x) => CAT_NAMES[x.cat]);
  const choices = Object.entries(CAT_NAMES).map(([cat, name]) => ({ text: name, ok: cat === a.cat }));
  return {
    key: `acc:${a.id}`, qid: `v-acc-${a.id}`,
    stem: `勘定科目「${a.name}」は5要素のどれに分類されますか。`,
    choices, explanation: `${a.name}は「${CAT_NAMES[a.cat]}」の勘定科目です。`,
  };
}

export async function renderVocab(app, container) {
  container.innerHTML = `<div class="spin"></div>`;
  let points;
  try {
    points = await loadKeypoints();
  } catch (e) {
    container.innerHTML = `<p class="empty-note">単語テストの読み込みに失敗しました</p>`;
    return;
  }
  const accounts = app.accounts;
  const session = { answered: 0, correct: 0, streak: 0, best: 0, recent: [] };

  const intro = () => {
    container.innerHTML = `
      <h1 class="page-title">単語テスト</h1>
      <div class="card">
        <span class="card-title">エンドレス形式</span>
        <p class="card-sub mt-8">重要事項の意味と勘定科目の分類をランダムに出題します。終了するまで永遠に続きます。すきま時間の反復練習に最適です。解答は今日の学習量にカウントされます。</p>
      </div>
      <button class="btn btn-accent btn-block" id="start">はじめる</button>
      <button class="btn btn-ghost btn-block mt-8" onclick="location.hash='#ref'">重要事項集を見る</button>`;
    container.querySelector("#start").onclick = next;
  };

  const next = () => {
    const q = Math.random() < 0.5 ? makeKeypointQ(points, session.recent) : makeAccountQ(accounts, session.recent);
    session.recent.push(q.key);
    if (session.recent.length > 30) session.recent.shift();

    container.innerHTML = `
      <div class="vocab-score">
        <span>解答 <span class="num">${session.answered}</span></span>
        <span>正解 <span class="num">${session.correct}</span></span>
        <span>連続 <span class="num">${session.streak}</span>（最高 ${session.best}）</span>
      </div>
      <div class="card"><p class="quiz-stem">${esc(q.stem)}</p></div>
      <div class="choices" id="vocab-choices">${q.choices.map((c, i) =>
        `<button class="choice-btn" data-i="${i}"><span class="cmark">${"アイウエオ"[i]}</span>${esc(c.text)}</button>`).join("")}</div>
      <div id="vocab-result"></div>
      <button class="btn btn-ghost btn-block mt-16" id="vocab-quit">終了する</button>`;

    container.querySelectorAll(".choice-btn").forEach((btn) => {
      btn.onclick = () => {
        const picked = q.choices[Number(btn.dataset.i)];
        session.answered++;
        if (picked.ok) {
          session.correct++;
          session.streak++;
          session.best = Math.max(session.best, session.streak);
        } else {
          session.streak = 0;
        }
        Store.recordAnswer(q.qid, [], picked.ok);
        container.querySelectorAll(".choice-btn").forEach((b) => {
          const c = q.choices[Number(b.dataset.i)];
          b.disabled = true;
          if (c.ok) b.classList.add("correct");
          else if (b === btn) b.classList.add("wrong");
        });
        container.querySelector("#vocab-result").innerHTML = `
          <div class="result-banner ${picked.ok ? "ok" : "ng"}">${picked.ok ? "正解！" : "不正解"}</div>
          ${picked.ok ? "" : `<p class="explain mt-8">${esc(q.explanation)}</p>`}
          <button class="btn btn-primary btn-block mt-16" id="vocab-next">次の問題へ</button>`;
        container.querySelector("#vocab-next").onclick = next;
      };
    });
    container.querySelector("#vocab-quit").onclick = summary;
  };

  const summary = () => {
    const acc = session.answered ? Math.round((session.correct / session.answered) * 100) : 0;
    container.innerHTML = `
      <div class="set-result-hero">
        <p class="muted">単語テスト おつかれさまでした</p>
        <div class="big num">${session.correct}<small> / ${session.answered}問</small></div>
        <p class="muted num">正答率 ${acc}% ・ 最高連続 ${session.best}</p>
      </div>
      <button class="btn btn-accent btn-block" id="again">もう一度はじめる</button>
      <button class="btn btn-primary btn-block mt-8" onclick="location.hash='#home'">ホームへ</button>`;
    container.querySelector("#again").onclick = () => {
      session.answered = 0; session.correct = 0; session.streak = 0; session.best = 0;
      next();
    };
  };

  intro();
}
