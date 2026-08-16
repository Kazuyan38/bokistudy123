// store.js — localStorage永続化・進捗・統計・バックアップ
// キー設計は DESIGN.md §4.8 が正本

const KEYS = {
  profile: "boki.v1.profile",
  progress: "boki.v1.progress",
  srs: "boki.v1.srs",
  stats: "boki.v1.stats",
  mocks: "boki.v1.mocks",
};

function load(key, def) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(def);
    return { ...structuredClone(def), ...JSON.parse(raw) };
  } catch {
    return structuredClone(def);
  }
}
function persist(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

export function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DEFAULTS = {
  profile: { schemaVersion: 1, dailyGoal: 20, examDate: null, lastBackupPrompt: null },
  progress: { schemaVersion: 1, units: {} },
  srs: { schemaVersion: 1, cards: {} },
  stats: {
    schemaVersion: 1,
    days: {},          // "YYYY-MM-DD" -> { answered, correct }
    topics: {},        // topicId -> { answered, correct }
    questions: {},     // qid -> { attempts, correct }
    streak: { current: 0, best: 0, lastDone: null, tickets: 2, ticketMonth: null },
  },
  mocks: { schemaVersion: 1, results: [] },
};

const state = {
  profile: load(KEYS.profile, DEFAULTS.profile),
  progress: load(KEYS.progress, DEFAULTS.progress),
  srs: load(KEYS.srs, DEFAULTS.srs),
  stats: load(KEYS.stats, DEFAULTS.stats),
  mocks: load(KEYS.mocks, DEFAULTS.mocks),
};

export const Store = {
  // ---- プロフィール ----
  get profile() { return state.profile; },
  setProfile(patch) {
    Object.assign(state.profile, patch);
    persist(KEYS.profile, state.profile);
  },

  // ---- 単元進捗 ----
  unit(unitId) {
    if (!state.progress.units[unitId]) {
      state.progress.units[unitId] = { lessonDone: [], testBest: 0, passed: false, passedAt: null, srsIntroduced: false };
    }
    return state.progress.units[unitId];
  },
  markSectionDone(unitId, secId) {
    const u = this.unit(unitId);
    if (!u.lessonDone.includes(secId)) u.lessonDone.push(secId);
    persist(KEYS.progress, state.progress);
  },
  isLessonComplete(unitId, sectionCount) {
    return this.unit(unitId).lessonDone.length >= sectionCount;
  },
  markSrsIntroduced(unitId) {
    this.unit(unitId).srsIntroduced = true;
    persist(KEYS.progress, state.progress);
  },
  recordTest(unitId, pct) {
    const u = this.unit(unitId);
    u.testBest = Math.max(u.testBest, pct);
    if (pct >= 80 && !u.passed) {
      u.passed = true;
      u.passedAt = todayStr();
    }
    persist(KEYS.progress, state.progress);
    return u.passed;
  },
  isPassed(unitId) { return !!state.progress.units[unitId]?.passed; },

  // ---- SRS ----
  srsCard(cardId) { return state.srs.cards[cardId] || null; },
  srsSet(cardId, card) {
    state.srs.cards[cardId] = card;
    persist(KEYS.srs, state.srs);
  },
  srsAll() { return state.srs.cards; },
  srsIntroduce(qids) {
    const today = todayStr();
    for (const qid of qids) {
      if (!state.srs.cards[qid]) {
        state.srs.cards[qid] = { ef: 2.5, ivl: 0, reps: 0, lapses: 0, due: today };
      }
    }
    persist(KEYS.srs, state.srs);
  },

  // ---- 解答統計 ----
  recordAnswer(qid, topics, correct) {
    const day = todayStr();
    const s = state.stats;
    s.days[day] = s.days[day] || { answered: 0, correct: 0 };
    s.days[day].answered++;
    if (correct) s.days[day].correct++;
    for (const t of topics || []) {
      s.topics[t] = s.topics[t] || { answered: 0, correct: 0 };
      s.topics[t].answered++;
      if (correct) s.topics[t].correct++;
    }
    s.questions[qid] = s.questions[qid] || { attempts: 0, correct: 0 };
    s.questions[qid].attempts++;
    if (correct) s.questions[qid].correct++;
    this._updateStreak();
    persist(KEYS.stats, state.stats);
  },
  todayCount() {
    const d = state.stats.days[todayStr()];
    return d ? d.answered : 0;
  },
  days() { return state.stats.days; },
  topicStats() { return state.stats.topics; },
  questionStats() { return state.stats.questions; },

  _updateStreak() {
    const st = state.stats.streak;
    const today = todayStr();
    if (st.lastDone === today) return;
    if (this.todayCount() >= state.profile.dailyGoal) {
      const yesterday = todayStr(-1);
      st.current = st.lastDone === yesterday ? st.current + 1 : 1;
      st.best = Math.max(st.best, st.current);
      st.lastDone = today;
    }
  },
  streak() { return state.stats.streak; },

  // ---- 模試 ----
  recordMock(result) {
    state.mocks.results.push(result);
    persist(KEYS.mocks, state.mocks);
  },
  mockResults() { return state.mocks.results; },

  // ---- バックアップ ----
  exportAll() {
    return JSON.stringify({
      exported: new Date().toISOString(),
      app: "BokiStudy",
      data: state,
    }, null, 2);
  },
  importAll(json) {
    const parsed = JSON.parse(json);
    if (!parsed?.data?.profile || !parsed?.data?.srs) throw new Error("バックアップ形式が不正です");
    for (const k of Object.keys(KEYS)) {
      if (parsed.data[k]) {
        state[k] = parsed.data[k];
        persist(KEYS[k], state[k]);
      }
    }
  },
  resetAll() {
    for (const k of Object.keys(KEYS)) {
      state[k] = structuredClone(DEFAULTS[k]);
      localStorage.removeItem(KEYS[k]);
    }
  },

  // ---- 質問用サマリー ----
  summaryMarkdown(app) {
    const today = todayStr();
    let answered7 = 0, correct7 = 0;
    for (let i = 0; i < 7; i++) {
      const d = state.stats.days[todayStr(-i)];
      if (d) { answered7 += d.answered; correct7 += d.correct; }
    }
    const acc7 = answered7 ? Math.round((correct7 / answered7) * 100) : 0;

    const topicRows = Object.entries(state.stats.topics)
      .filter(([, v]) => v.answered >= 4)
      .map(([id, v]) => ({ id, acc: v.correct / v.answered, n: v.answered }))
      .sort((a, b) => a.acc - b.acc)
      .slice(0, 5);
    const topicName = (id) => app?.topicById?.(id)?.name || id;

    const cards = Object.entries(state.srs.cards);
    const overdue = cards.filter(([, c]) => c.due < today).length;

    const cur = app?.currentUnit?.();
    const lines = [
      `## BokiStudy 学習サマリー (${today})`,
      cur ? `- 現在: ${cur.stageTitle} ${cur.id}「${cur.title}」（レッスン${cur.done}/${cur.total}セクション${cur.passed ? "・単元合格済み" : ""}）` : "- 現在: 未開始",
      `- 直近7日: ${answered7}問解答・正答率${acc7}%・ストリーク${state.stats.streak.current}日`,
      `- 弱点論点: ${topicRows.length ? topicRows.map((t) => `${topicName(t.id)}(${Math.round(t.acc * 100)}%)`).join(", ") : "まだデータ不足"}`,
      `- SRS: カード${cards.length}枚 / 期日超過${overdue}枚`,
    ];
    return lines.join("\n");
  },
};
