// app.js — 起動・ルーティング・ホーム/マップ/単元/ドリル/テスト/設定
// 学習フローの設計は DESIGN.md §1・§5 が正本

import { Store, Users, todayStr } from "./store.js";
import { dueQueue, dueCount } from "./srs.js";
import { runSession, renderSetResult } from "./quiz.js";
import { renderLesson } from "./lesson.js";
import { renderMockList, renderMockIntro } from "./mock.js";
import { renderStats } from "./stats.js";
import { computePlan, renderPlanCard, planStatusLabel, recommendedDailyGoal } from "./plan.js";
import { esc } from "./render/figures.js";

const screen = () => document.getElementById("screen");

const app = {
  curriculum: null,
  accounts: [],
  topics: [],
  lessons: {},        // unitId -> lesson
  questionsByUnit: {},// unitId -> [q]
  _qIndex: new Map(),
  _unitIndex: new Map(),
  _unitOrder: new Map(),
  _accIndex: new Map(),
  _topicIndex: new Map(),

  unitById(id) { return this._unitIndex.get(id); },
  questionById(id) { return this._qIndex.get(id); },
  accountById(id) { return this._accIndex.get(id); },
  topicById(id) { return this._topicIndex.get(id); },

  allUnits() { return this.curriculum.stages.flatMap((s) => s.units); },
  availableUnits() { return this.allUnits().filter((u) => u.status === "available"); },

  isUnlocked(unit) {
    if (unit.status !== "available") return false;
    return unit.prereq.every((p) => Store.isPassed(p));
  },

  /** この単元までに導入済みの勘定科目（仕訳パネル用） */
  accountsForUnit(unitId) {
    const order = this._unitOrder.get(unitId) ?? 0;
    return this.accounts.filter((a) => (this._unitOrder.get(a.introducedIn) ?? 999) <= order);
  },

  /** 学習サマリー用の現在地 */
  currentUnit() {
    for (const st of this.curriculum.stages) {
      for (const u of st.units) {
        if (u.status !== "available") continue;
        const lesson = this.lessons[u.id];
        const done = Store.unit(u.id).lessonDone.length;
        const total = lesson?.sections.length ?? 0;
        if (!Store.isPassed(u.id) || done < total) {
          return { ...u, stageTitle: st.title, done, total, passed: Store.isPassed(u.id) };
        }
      }
    }
    return null;
  },

  toast(msg, ms = 2600) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => (t.hidden = true), ms);
  },

  celebrate({ title, body, actions = [] }) {
    const ov = document.getElementById("overlay");
    const confetti = Array.from({ length: 18 }, (_, i) => {
      const colors = ["#D9AE55", "#6E90C9", "#55B885", "#E8C77A", "#6C93CC"];
      return `<i class="confetti" style="left:${5 + Math.random() * 90}%;background:${colors[i % colors.length]};animation-delay:${Math.random() * .5}s"></i>`;
    }).join("");
    ov.innerHTML = `<div class="overlay-card">${confetti}
      <div class="medal"><svg viewBox="0 0 24 24"><path d="M6 3h12l-2.2 6.6a6 6 0 1 1-7.6 0Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.5 13.5l1.8 1.8 3.4-3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <h2>${esc(title)}</h2><p>${esc(body)}</p>
      <div id="cele-actions"></div></div>`;
    const area = ov.querySelector("#cele-actions");
    for (const a of actions) {
      const b = document.createElement("button");
      b.className = `btn ${a.primary ? "btn-accent" : "btn-ghost"} btn-block mt-8`;
      b.textContent = a.label;
      b.onclick = () => { ov.hidden = true; if (a.hash) location.hash = a.hash; if (a.onClick) a.onClick(); };
      area.append(b);
    }
    ov.hidden = false;
  },
};

/* ============================== データ読み込み ============================== */

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} の読み込みに失敗（${res.status}）`);
  return res.json();
}

function renderProfileGate(container) {
  const users = Users.list();
  container.innerHTML = `
    <div class="home-head"><div class="home-brand">BokiStudy<small>簿記2級への道</small></div></div>
    <div class="card">
      <span class="card-title">${users.length ? "だれが使いますか？" : "はじめまして"}</span>
      <p class="card-sub mt-8">${users.length
        ? "同じ端末を複数人で使う場合、プロフィールごとに学習記録が分かれます。"
        : "学習記録を分けて管理するため、まずプロフィール名を入力してください。"}</p>
      ${users.length ? `<div class="mt-16">${users.map((u) =>
        `<button class="unit-row" style="width:100%;text-align:left" data-uid="${u.id}">
          <div class="unit-mark current">👤</div>
          <div class="unit-title">${esc(u.name)}</div>
        </button>`).join("")}</div>` : ""}
      <div class="setting-row" style="border:none;padding-top:${users.length ? "14px" : "0"}">
        <input type="text" id="new-name" placeholder="新しいプロフィール名" maxlength="20" style="flex:1;border:1.5px solid var(--c-line);border-radius:10px;padding:10px 12px;background:var(--c-card)">
      </div>
      <button class="btn btn-accent btn-block" id="new-profile">この名前ではじめる</button>
    </div>`;

  container.querySelectorAll("[data-uid]").forEach((btn) => {
    btn.onclick = () => { Users.switchTo(btn.dataset.uid); location.reload(); };
  });
  const nameInput = container.querySelector("#new-name");
  container.querySelector("#new-profile").onclick = () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    Users.create(name);
    location.reload();
  };
}

async function boot() {
  if (!Users.activeId()) {
    renderProfileGate(screen());
    return;
  }
  screen().innerHTML = `<div class="spin"></div>`;
  try {
    const [curriculum, accountsDoc, topicsDoc] = await Promise.all([
      loadJson("data/curriculum.json"),
      loadJson("data/accounts.json"),
      loadJson("data/topics.json"),
    ]);
    app.curriculum = curriculum;
    app.accounts = accountsDoc.accounts;
    app.topics = topicsDoc.topics;

    let order = 0;
    for (const st of curriculum.stages) {
      for (const u of st.units) {
        app._unitIndex.set(u.id, u);
        app._unitOrder.set(u.id, order++);
      }
    }
    for (const a of app.accounts) app._accIndex.set(a.id, a);
    for (const t of app.topics) app._topicIndex.set(t.id, t);

    const avail = app.availableUnits();
    const results = await Promise.allSettled(avail.flatMap((u) => [
      loadJson(`data/lessons/${u.id}.json`).then((l) => (app.lessons[u.id] = l)),
      loadJson(`data/questions/${u.id}.json`).then((qd) => {
        app.questionsByUnit[u.id] = qd.questions;
        for (const q of qd.questions) app._qIndex.set(q.id, q);
      }),
    ]));
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) console.warn("一部コンテンツの読み込みに失敗:", failed);

    const goal = recommendedDailyGoal(app);
    if (Store.profile.dailyGoal !== goal) Store.setProfile({ dailyGoal: goal });

    window.addEventListener("hashchange", route);
    route();
    backupReminder();
  } catch (e) {
    screen().innerHTML = `<p class="empty-note">データの読み込みに失敗しました。<br>${esc(e.message)}<br>通信環境を確認して再読み込みしてください。</p>`;
  }
}

function backupReminder() {
  const last = Store.profile.lastBackupPrompt;
  const week = todayStr(-7);
  if (!last || last < week) {
    const hasData = Store.todayCount() > 0 || Object.keys(Store.srsAll()).length > 0;
    if (hasData) {
      app.toast("週に一度、設定からバックアップを取りましょう", 4000);
      Store.setProfile({ lastBackupPrompt: todayStr() });
    }
  }
}

/* ============================== ルーター ============================== */

function route() {
  const hash = location.hash || "#home";
  const [path, ...args] = hash.slice(1).split("/");

  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === path);
  });

  const s = screen();
  s.style.animation = "none";
  void s.offsetHeight; // 再アニメーション
  s.style.animation = "";

  if (path === "home") renderHome(s);
  else if (path === "map") renderMap(s);
  else if (path === "unit") renderUnit(s, args[0]);
  else if (path === "lesson") renderLesson(app, s, args[0], Number(args[1] || 0));
  else if (path === "drill") startDrill(s, args[0]);
  else if (path === "review") startReview(s);
  else if (path === "test") startTest(s, args[0]);
  else if (path === "mocks") renderMockList(app, s);
  else if (path === "mock-intro") renderMockIntro(app, s, args[0]);
  else if (path === "stats") renderStats(app, s);
  else if (path === "settings") renderSettings(s);
  else renderHome(s);
}

/* ============================== ホーム ============================== */

function renderHome(container) {
  const goal = Store.profile.dailyGoal;
  const done = Store.todayCount();
  const pct = Math.min(1, done / goal);
  const R = 46, CIRC = 2 * Math.PI * R;
  const streak = Store.streak();
  const due = dueCount(Store.srsAll());
  const cur = app.currentUnit();

  const flame = `<svg viewBox="0 0 24 24"><path d="M12 2.5c.4 3-1.8 4.6-3.2 6.4C7.3 10.8 6.5 12.6 6.5 14.5a5.5 5.5 0 0 0 11 0c0-3.5-2.6-5-2.9-8-1.1 1-1.7 2.3-1.6 3.8-1.3-1.7-1.4-4.6-1-7.8Z" fill="currentColor"/></svg>`;

  container.innerHTML = `
    <div class="home-head">
      <div class="home-brand">BokiStudy<small>簿記2級への道</small></div>
      <div class="streak">${flame}<span class="num">${streak.current}</span>日</div>
    </div>

    <div class="card">
      <div class="hero">
        <div class="ring-wrap">
          <svg width="108" height="108" viewBox="0 0 108 108">
            <circle class="ring-bg" cx="54" cy="54" r="${R}"/>
            <circle class="ring-fg" cx="54" cy="54" r="${R}" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC * (1 - pct)}"/>
          </svg>
          <div class="ring-label"><span class="num">${done}</span><span>/ ${goal}問</span></div>
        </div>
        <div class="hero-copy">
          <h2>${done >= goal ? "今日の目標達成！" : "今日もコツコツと。"}</h2>
          <p>${done >= goal ? "この調子で続けましょう。追加のドリルも歓迎です。" : `あと${goal - done}問で今日の目標です。`}</p>
        </div>
      </div>
    </div>

    ${renderPlanCard(computePlan(app), { compact: true })}

    <a href="#review" class="card card-tappable menu-row" style="display:flex">
      <div class="menu-num" style="background:var(--c-accent-soft);color:var(--c-accent-ink)">①</div>
      <div class="grow">
        <div class="card-title">今日の復習${due ? ` <span class="num" style="color:var(--c-accent)">${due}枚</span>` : ""}</div>
        <div class="card-sub">${due ? "忘れかけた頃が、いちばん記憶に残るタイミングです" : "今日の復習はありません"}</div>
      </div>
      ${due ? `<span class="chev">›</span>` : `<span class="badge-done">✓</span>`}
    </a>

    ${cur ? `<a href="${cur.done < cur.total ? `#lesson/${cur.id}/${cur.done}` : `#unit/${cur.id}`}" class="card card-tappable menu-row" style="display:flex">
      <div class="menu-num" style="background:var(--c-bg2);color:var(--c-debit)">②</div>
      <div class="grow">
        <div class="card-title">続きのレッスン</div>
        <div class="card-sub">${esc(cur.title)}（セクション ${cur.done}/${cur.total}${cur.done >= cur.total ? "・テストに挑戦" : ""}）</div>
      </div>
      <span class="chev">›</span>
    </a>` : ""}

    <a href="#drill/mix" class="card card-tappable menu-row" style="display:flex">
      <div class="menu-num" style="background:var(--c-ok-soft);color:var(--c-ok)">③</div>
      <div class="grow">
        <div class="card-title">今日のドリル 10問</div>
        <div class="card-sub">弱点論点を優先したミックス出題（交互練習）</div>
      </div>
      <span class="chev">›</span>
    </a>
    <p class="muted center mt-16">①→②→③の順で進めるのがおすすめです（約25〜30分）</p>`;
}

/* ============================== 学習マップ ============================== */

function renderMap(container) {
  const check = `<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const lock = `<svg viewBox="0 0 24 24"><rect x="5.5" y="10.5" width="13" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;

  const qStats = Store.questionStats();
  const unitAcc = (uid) => {
    let a = 0, c = 0;
    for (const q of app.questionsByUnit[uid] || []) {
      const s = qStats[q.id];
      if (s) { a += s.attempts; c += s.correct; }
    }
    return a ? Math.round((c / a) * 100) : null;
  };

  container.innerHTML = `<h1 class="page-title">学習マップ</h1>` +
    app.curriculum.stages.map((st) => {
      const passedCount = st.units.filter((u) => Store.isPassed(u.id)).length;
      return `<div class="stage-block">
        <div class="stage-head"><h2>Stage ${st.id}　${esc(st.title)}</h2><span class="muted num">${passedCount}/${st.units.length}</span></div>
        ${st.units.map((u) => {
          const passed = Store.isPassed(u.id);
          const unlocked = app.isUnlocked(u);
          const planned = u.status === "planned";
          const acc = unitAcc(u.id);
          const cls = planned ? "planned" : (!unlocked && !passed ? "locked" : "");
          const mark = passed
            ? `<div class="unit-mark passed">${check}</div>`
            : planned || !unlocked
              ? `<div class="unit-mark locked">${lock}</div>`
              : `<div class="unit-mark current">▶</div>`;
          const inner = `${mark}
            <div><div class="unit-title">${esc(u.title)}</div>
            <div class="unit-meta">${planned ? "近日追加（Claudeに作成を依頼できます）" : `${u.id} ・ 約${u.estMinutes}分`}</div></div>
            ${acc != null ? `<span class="unit-acc num" style="color:${acc >= 80 ? "var(--c-ok)" : acc >= 50 ? "var(--c-accent-ink)" : "var(--c-ng)"}">${acc}%</span>` : ""}`;
          return planned || (!unlocked && !passed)
            ? `<div class="unit-row ${cls}">${inner}</div>`
            : `<a href="#unit/${u.id}" class="unit-row">${inner}</a>`;
        }).join("")}
      </div>`;
    }).join("");
}

/* ============================== 単元ページ ============================== */

function renderUnit(container, unitId) {
  const unit = app.unitById(unitId);
  const lesson = app.lessons[unitId];
  if (!unit || !lesson) { container.innerHTML = `<p class="empty-note">単元が見つかりません</p>`; return; }
  const prog = Store.unit(unitId);
  const passed = Store.isPassed(unitId);
  const secDone = prog.lessonDone.length;
  const secTotal = lesson.sections.length;
  const lessonComplete = secDone >= secTotal;

  container.innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="location.hash='#map'">← 学習マップ</button>
    <h1 class="page-title mt-16">${esc(unit.title)} ${passed ? `<span class="badge-done">合格済み ✓</span>` : ""}</h1>
    <div class="card">
      <span class="card-title">レッスン</span>
      <div class="lesson-prog mt-8">${lesson.sections.map((s) =>
        `<i class="${prog.lessonDone.includes(s.id) ? "done" : ""}"></i>`).join("")}</div>
      <p class="card-sub num">${secDone} / ${secTotal} セクション完了</p>
      <div class="mt-16">${lesson.sections.map((s, i) => {
        const done = prog.lessonDone.includes(s.id);
        return `<a href="#lesson/${unitId}/${i}" class="setting-row" style="display:flex">
          <label>${i + 1}. ${esc(s.title)}</label>
          <span>${done ? `<span class="badge-done">✓</span>` : `<span class="chev">›</span>`}</span>
        </a>`;
      }).join("")}</div>
    </div>
    <div class="unit-actions">
      <button class="btn btn-primary" id="u-drill" ${lessonComplete ? "" : "disabled"}>ドリル</button>
      <button class="btn btn-accent" id="u-test" ${lessonComplete ? "" : "disabled"}>単元テスト</button>
    </div>
    ${!lessonComplete ? `<p class="muted center mt-8">レッスンを全て終えるとドリルとテストが開きます</p>` : ""}
    ${passed ? "" : `<p class="muted center mt-8">単元テストで80%以上とると次の単元が開きます</p>`}
    ${unitId === "s4-u03" && lessonComplete ? `<button class="btn btn-accent btn-block mt-16" onclick="location.hash='#mocks'">2級模試に挑戦する</button>` : ""}`;

  container.querySelector("#u-drill").onclick = () => (location.hash = `#drill/unit-${unitId}`);
  container.querySelector("#u-test").onclick = () => (location.hash = `#test/${unitId}`);
}

/* ============================== ドリル ============================== */

function pickWeighted(questions, n) {
  // 未演習 > 低正答率 > その他 の優先度で重み付けサンプル
  const qStats = Store.questionStats();
  const tStats = Store.topicStats();
  const weight = (q) => {
    const s = qStats[q.id];
    if (!s) return 5; // 未演習
    const acc = s.correct / s.attempts;
    let w = acc < 0.5 ? 4 : acc < 0.8 ? 2.5 : 1;
    for (const t of q.topics || []) {
      const ts = tStats[t];
      if (ts && ts.answered >= 4 && ts.correct / ts.answered < 0.6) w += 1.5; // 弱点論点ブースト
    }
    return w;
  };
  const pool = questions.map((q) => ({ q, w: weight(q) }));
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) { idx = i; break; } }
    out.push(pool.splice(idx, 1)[0].q);
  }
  // 交互練習: 同一単元が続きすぎないよう軽くシャッフル
  return out.sort(() => Math.random() - 0.5);
}

function startDrill(container, mode) {
  let questions = [];
  let title = "";
  let unitForAccounts = null;

  if (mode?.startsWith("unit-")) {
    const unitId = mode.slice(5);
    questions = pickWeighted(app.questionsByUnit[unitId] || [], 10);
    title = `${app.unitById(unitId)?.title || ""} ドリル`;
    unitForAccounts = unitId;
  } else {
    // ミックス: レッスン完了済み単元の全問題から
    const unlockedUnits = app.availableUnits().filter((u) =>
      Store.unit(u.id).lessonDone.length >= (app.lessons[u.id]?.sections.length || 99));
    const pool = unlockedUnits.flatMap((u) => app.questionsByUnit[u.id] || []);
    questions = pickWeighted(pool, 10);
    title = "今日のドリル（ミックス）";
    unitForAccounts = unlockedUnits.at(-1)?.id;
  }

  if (!questions.length) {
    container.innerHTML = `<p class="empty-note">まだ出題できる問題がありません。<br>まずはレッスンを進めましょう。</p>
      <button class="btn btn-primary btn-block" onclick="location.hash='#map'">学習マップへ</button>`;
    return;
  }

  runSession({
    app, container, questions, mode: "drill", title,
    accounts: app.accountsForUnit(unitForAccounts || "s1-u01"),
    onFinish: (r) => {
      if (r.aborted) { location.hash = "#home"; return; }
      renderSetResult(container, {
        title, correct: r.correct, total: r.total, wrongQids: r.wrongQids,
        questionById: (id) => app.questionById(id),
        actions: [
          { label: "もう一度", primary: false, onClick: () => startDrill(container, mode) },
          { label: "ホームへ", primary: true, onClick: () => (location.hash = "#home") },
        ],
      });
    },
  });
}

/* ============================== 復習（SRS） ============================== */

function startReview(container) {
  const qids = dueQueue(Store.srsAll());
  const questions = qids.map((id) => app.questionById(id)).filter(Boolean);
  if (!questions.length) {
    container.innerHTML = `<p class="empty-note">今日の復習カードはありません 🎉<br>レッスンを進めるか、ドリルに挑戦しましょう。</p>
      <button class="btn btn-primary btn-block" onclick="location.hash='#home'">ホームへ</button>`;
    return;
  }
  const lastUnit = app.availableUnits().at(-1)?.id || "s1-u01";
  runSession({
    app, container, questions, mode: "review", title: "今日の復習",
    accounts: app.accountsForUnit(lastUnit),
    onFinish: (r) => {
      if (r.aborted) { location.hash = "#home"; return; }
      renderSetResult(container, {
        title: "今日の復習", correct: r.correct, total: r.total, wrongQids: r.wrongQids,
        questionById: (id) => app.questionById(id),
        actions: [{ label: "ホームへ", primary: true, onClick: () => (location.hash = "#home") }],
      });
    },
  });
}

/* ============================== 単元テスト ============================== */

function startTest(container, unitId) {
  const unit = app.unitById(unitId);
  const pool = app.questionsByUnit[unitId] || [];
  const cores = pool.filter((q) => q.srs);
  const others = pool.filter((q) => !q.srs);
  const sample = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
  const questions = [...sample(cores, 5), ...sample(others, 5)].sort(() => Math.random() - 0.5);

  if (questions.length < 10) {
    container.innerHTML = `<p class="empty-note">テスト問題が不足しています</p>`;
    return;
  }

  runSession({
    app, container, questions, mode: "test", title: `${unit.title} 単元テスト`,
    accounts: app.accountsForUnit(unitId),
    onFinish: (r) => {
      if (r.aborted) { location.hash = `#unit/${unitId}`; return; }
      const pct = Math.round((r.correct / r.total) * 100);
      const wasPassed = Store.isPassed(unitId);
      Store.recordTest(unitId, pct);
      const nowPassed = Store.isPassed(unitId);
      if (!wasPassed && nowPassed) Store.setProfile({ dailyGoal: recommendedDailyGoal(app) });

      renderSetResult(container, {
        title: `${unit.title} 単元テスト`, correct: r.correct, total: r.total, wrongQids: r.wrongQids,
        questionById: (id) => app.questionById(id),
        actions: [
          ...(pct < 80 ? [{ label: "復習してもう一度", primary: true, onClick: () => (location.hash = `#unit/${unitId}`) }] : []),
          { label: "学習マップへ", primary: pct >= 80, onClick: () => (location.hash = "#map") },
        ],
      });

      if (!wasPassed && nowPassed) {
        const nextUnit = app.allUnits().find((u) => u.prereq.includes(unitId));
        app.celebrate({
          title: "単元合格！",
          body: `「${unit.title}」を${pct}%でクリア。${nextUnit && nextUnit.status === "available" ? `次は「${nextUnit.title}」が開きました。` : "次の単元はコンテンツ追加をお楽しみに。"}`,
          actions: [
            ...(nextUnit && nextUnit.status === "available" ? [{ label: `次へ: ${nextUnit.title}`, primary: true, hash: `#unit/${nextUnit.id}` }] : []),
            { label: "学習マップへ", hash: "#map" },
          ],
        });
      } else if (pct < 80) {
        app.toast("あと少し！間違えた論点を復習して、24時間後に再挑戦しましょう");
      }
    },
  });
}

/* ============================== 設定 ============================== */

function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

function examDateSelectsHTML(examDate) {
  const [ey, em, ed] = examDate ? examDate.split("-").map(Number) : [null, null, null];
  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear + 1, thisYear + 2, thisYear + 3];
  const yearOpts = `<option value="">未設定</option>` +
    years.map((y) => `<option value="${y}" ${y === ey ? "selected" : ""}>${y}年</option>`).join("");
  const monthOpts = Array.from({ length: 12 }, (_, i) => i + 1)
    .map((m) => `<option value="${m}" ${m === em ? "selected" : ""}>${m}月</option>`).join("");
  const dMax = ey && em ? daysInMonth(ey, em) : 31;
  const curDay = ed ? Math.min(ed, dMax) : 1;
  const dayOpts = Array.from({ length: dMax }, (_, i) => i + 1)
    .map((d) => `<option value="${d}" ${d === curDay ? "selected" : ""}>${d}日</option>`).join("");
  return `<div class="date-select-row">
    <select class="y" id="exam-y">${yearOpts}</select>
    <select class="m" id="exam-m" ${ey ? "" : "disabled"}>${monthOpts}</select>
    <select class="d" id="exam-d" ${ey ? "" : "disabled"}>${dayOpts}</select>
  </div>`;
}

function bindExamSelects(container) {
  const y = container.querySelector("#exam-y");
  const m = container.querySelector("#exam-m");
  const d = container.querySelector("#exam-d");

  const rebuildDayOptions = () => {
    const yy = Number(y.value), mm = Number(m.value);
    const max = daysInMonth(yy, mm);
    const cur = Math.min(Number(d.value) || 1, max);
    d.innerHTML = Array.from({ length: max }, (_, i) => i + 1)
      .map((day) => `<option value="${day}" ${day === cur ? "selected" : ""}>${day}日</option>`).join("");
  };

  const persist = () => {
    if (!y.value) {
      Store.setProfile({ examDate: null });
      app.toast("目標受験日を解除しました");
    } else {
      const p2 = (n) => String(n).padStart(2, "0");
      Store.setProfile({ examDate: `${y.value}-${p2(m.value)}-${p2(d.value)}` });
      app.toast("目標受験日を設定しました。1日の目標を再計算します");
    }
    Store.setProfile({ dailyGoal: recommendedDailyGoal(app) });
    renderSettings(container);
  };

  y.onchange = () => {
    if (y.value && !m.value) m.value = "1";
    m.disabled = !y.value;
    d.disabled = !y.value;
    if (y.value) rebuildDayOptions();
    persist();
  };
  m.onchange = () => { rebuildDayOptions(); persist(); };
  d.onchange = persist;
}

function renderSettings(container) {
  const p = Store.profile;
  const plan = computePlan(app);
  const activeUser = Users.active();
  const otherUsers = Users.list().filter((u) => u.id !== Users.activeId());
  container.innerHTML = `
    <h1 class="page-title">設定</h1>

    <div class="card">
      <span class="card-title">プロフィール</span>
      <div class="setting-row">
        <label>現在のプロフィール</label>
        <span class="num">${esc(activeUser?.name || "")}</span>
      </div>
      <button class="btn btn-ghost btn-block mt-8" id="rename-profile">名前を変更</button>
      ${otherUsers.length ? `<p class="muted mt-16 mb-8">切り替え</p>${otherUsers.map((u) =>
        `<button class="unit-row" style="width:100%;text-align:left" data-switch="${u.id}">
          <div class="unit-mark current">👤</div><div class="unit-title">${esc(u.name)}</div>
        </button>`).join("")}` : ""}
      <button class="btn btn-ghost btn-block mt-16" id="add-profile">新しいプロフィールを追加</button>
      <button class="btn btn-ghost btn-block mt-8" id="delete-profile" style="color:var(--c-ng);border-color:var(--c-ng-soft)">このプロフィールを削除</button>
    </div>

    <div class="card">
      <div class="setting-row">
        <label>1日の目標（問）</label>
        <span class="num">${p.dailyGoal}問</span>
      </div>
      <p class="muted mt-8">目標受験日から逆算して、アプリが自動で調整します。手動では変更できません。</p>
      <div class="setting-row mt-8">
        <label>目標受験日（任意）</label>
        ${examDateSelectsHTML(p.examDate)}
      </div>
      <p class="muted mt-8">CBTは好きな日時を予約できます。目標日を設定すると、復習間隔の調整と学習ペースの診断に使われます。</p>
    </div>

    ${renderPlanCard(plan)}

    <div class="card">
      <span class="card-title">Claudeに質問する</span>
      <p class="card-sub">学習状況のサマリーをコピーして、Claudeへの質問に添えると、弱点に合わせた説明がもらえます。</p>
      <button class="btn btn-primary btn-block mt-16" id="copy-summary">質問用サマリーをコピー</button>
    </div>

    <div class="card">
      <span class="card-title">バックアップ</span>
      <p class="card-sub">学習データはこの端末のブラウザにのみ保存されます。週1回のバックアップをおすすめします。</p>
      <div class="unit-actions">
        <button class="btn btn-ghost" id="export-copy">コピー</button>
        <button class="btn btn-ghost" id="export-dl">ダウンロード</button>
      </div>
      <details class="mt-16">
        <summary class="muted">バックアップから復元する</summary>
        <textarea class="io-area" id="import-area" placeholder="バックアップJSONを貼り付け"></textarea>
        <button class="btn btn-ghost btn-block mt-8" id="import-btn">復元する</button>
      </details>
    </div>

    <div class="card">
      <button class="btn btn-ghost btn-block" id="reset" style="color:var(--c-ng);border-color:var(--c-ng-soft)">全データを初期化</button>
    </div>
    <p class="muted center">BokiStudy v0.1 — 学習科学ベースの簿記2級対策</p>`;

  container.querySelector("#rename-profile").onclick = () => {
    const name = prompt("新しいプロフィール名", activeUser?.name || "");
    if (!name || !name.trim()) return;
    Users.rename(Users.activeId(), name.trim());
    renderSettings(container);
  };
  container.querySelectorAll("[data-switch]").forEach((btn) => {
    btn.onclick = () => { Users.switchTo(btn.dataset.switch); location.reload(); };
  });
  container.querySelector("#add-profile").onclick = () => {
    const name = prompt("新しいプロフィール名を入力してください");
    if (!name || !name.trim()) return;
    Users.create(name.trim());
    location.reload();
  };
  container.querySelector("#delete-profile").onclick = () => {
    if (!confirm(`プロフィール「${activeUser?.name}」の学習記録をすべて削除します。よろしいですか？`)) return;
    if (!confirm("本当によろしいですか？この操作は取り消せません。")) return;
    Users.remove(Users.activeId());
    location.reload();
  };
  bindExamSelects(container);
  container.querySelector("#copy-summary").onclick = async () => {
    let text = Store.summaryMarkdown(app);
    if (plan) {
      const { label } = planStatusLabel(plan.overallStatus);
      text += `\n- 目標受験日: ${plan.examDate}（残り${plan.daysLeft}日・${label}）`;
    }
    await navigator.clipboard.writeText(text);
    app.toast("サマリーをコピーしました。Claudeに貼り付けて質問できます");
  };
  container.querySelector("#export-copy").onclick = async () => {
    await navigator.clipboard.writeText(Store.exportAll());
    app.toast("バックアップをコピーしました。メモ等に保存してください");
  };
  container.querySelector("#export-dl").onclick = () => {
    const blob = new Blob([Store.exportAll()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bokistudy-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  container.querySelector("#import-btn").onclick = () => {
    const v = container.querySelector("#import-area").value.trim();
    if (!v) return;
    if (!confirm("現在のデータを上書きして復元します。よろしいですか？")) return;
    try {
      Store.importAll(v);
      app.toast("復元しました");
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      app.toast(`復元に失敗: ${e.message}`);
    }
  };
  container.querySelector("#reset").onclick = () => {
    if (!confirm("学習履歴・復習カード・設定をすべて削除します。よろしいですか？")) return;
    if (!confirm("本当によろしいですか？この操作は取り消せません。")) return;
    Store.resetAll();
    location.reload();
  };
}

/* ============================== 起動 ============================== */

boot();
