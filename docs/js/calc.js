// calc.js — 内蔵電卓（実務電卓準拠: 12桁・M+/M-/MR/MC・GT・√・%）
// 本番CBTでは実物電卓を使うため、挙動を一般的な実務電卓に寄せる

const MAX_DIGITS = 12;

const state = {
  display: "0",
  entering: true,     // 数値入力中か
  acc: null,          // 演算の左辺
  op: null,           // 保留中の演算子
  memory: 0,
  gt: 0,              // = のたびに加算されるグランドトータル
  lastEq: null,       // 直前の = の右辺（= 連打用）
};

function fmt(n) {
  if (!Number.isFinite(n)) return "E";
  let s = n.toPrecision(12).replace(/\.?0+$/, "");
  if (s.replace(/[-.]/g, "").length > MAX_DIGITS) return "E";
  const [int, dec] = s.split(".");
  const intFmt = Number(int).toLocaleString("ja-JP");
  return dec ? `${intFmt}.${dec}` : intFmt;
}

function currentValue() {
  return Number(state.display.replace(/,/g, ""));
}

function applyOp(a, op, b) {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "×": return a * b;
    case "÷": return b === 0 ? NaN : a / b;
    default: return b;
  }
}

function press(key) {
  const st = state;
  if (/^\d$/.test(key) || key === "00") {
    if (!st.entering) { st.display = "0"; st.entering = true; }
    const raw = st.display.replace(/,/g, "");
    const next = raw === "0" ? (key === "00" ? "0" : key) : raw + key;
    if (next.replace(/[-.]/g, "").length <= MAX_DIGITS) {
      st.display = next.includes(".") ? next : fmt(Number(next));
    }
  } else if (key === ".") {
    if (!st.entering) { st.display = "0"; st.entering = true; }
    if (!st.display.includes(".")) st.display += ".";
  } else if (key === "±") {
    st.display = st.display.startsWith("-") ? st.display.slice(1) : "-" + st.display;
  } else if (["+", "-", "×", "÷"].includes(key)) {
    if (st.op && st.entering) {
      const r = applyOp(st.acc, st.op, currentValue());
      st.display = fmt(r);
      st.acc = r;
    } else {
      st.acc = currentValue();
    }
    st.op = key;
    st.entering = false;
    st.lastEq = null;
  } else if (key === "=") {
    let rhs;
    if (st.op && st.entering) rhs = currentValue();
    else if (st.op) rhs = currentValue();
    else if (st.lastEq) { rhs = st.lastEq.rhs; st.op = st.lastEq.op; st.acc = currentValue(); }
    if (st.op != null) {
      const r = applyOp(st.acc ?? 0, st.op, rhs);
      st.lastEq = { op: st.op, rhs };
      st.display = fmt(r);
      st.gt += Number.isFinite(r) ? r : 0;
      st.acc = null; st.op = null; st.entering = false;
    }
  } else if (key === "√") {
    st.display = fmt(Math.sqrt(currentValue()));
    st.entering = false;
  } else if (key === "%") {
    // 実務電卓式: a × b % = a*b/100 / a ÷ b % = a/b*100
    if (st.op === "×") st.display = fmt((st.acc * currentValue()) / 100);
    else if (st.op === "÷") st.display = fmt((st.acc / currentValue()) * 100);
    else if (st.op === "+") st.display = fmt(st.acc + (st.acc * currentValue()) / 100);
    else if (st.op === "-") st.display = fmt(st.acc - (st.acc * currentValue()) / 100);
    st.acc = null; st.op = null; st.entering = false;
  } else if (key === "C") {
    st.display = "0"; st.entering = true;
  } else if (key === "AC") {
    st.display = "0"; st.entering = true; st.acc = null; st.op = null; st.gt = 0; st.lastEq = null;
  } else if (key === "⌫") {
    if (st.entering) {
      const raw = st.display.replace(/,/g, "").slice(0, -1);
      st.display = raw === "" || raw === "-" ? "0" : (raw.includes(".") ? raw : fmt(Number(raw)));
    }
  } else if (key === "M+") { st.memory += currentValue(); st.entering = false; }
  else if (key === "M-") { st.memory -= currentValue(); st.entering = false; }
  else if (key === "MR") { st.display = fmt(st.memory); st.entering = false; }
  else if (key === "MC") { st.memory = 0; }
  else if (key === "GT") { st.display = fmt(st.gt); st.entering = false; }
  render();
}

const KEYS = [
  ["MC", "MR", "M-", "M+", "÷"],
  ["√", "%", "GT", "⌫", "×"],
  ["7", "8", "9", "AC", "-"],
  ["4", "5", "6", "C", "+"],
  ["1", "2", "3", "±", "="],
  ["0", "00", ".", "", ""],
];

let sheetEl = null;

function render() {
  if (!sheetEl) return;
  const ind = [
    state.memory !== 0 ? "M" : "",
    state.op ? `演算 ${state.op}` : "",
    state.gt !== 0 ? "GT" : "",
  ].filter(Boolean).join("　");
  sheetEl.querySelector(".calc-ind").textContent = ind;
  sheetEl.querySelector(".calc-val").textContent = state.display;
}

export function initCalc() {
  sheetEl = document.getElementById("calc-sheet");
  const fab = document.getElementById("calc-fab");

  sheetEl.innerHTML = `
    <div style="position:relative">
      <button class="calc-close" id="calc-close">とじる ▼</button>
      <div class="calc-display" style="margin-top:26px">
        <div class="calc-ind"></div>
        <div class="calc-val">0</div>
      </div>
      <div class="calc-keys">
        ${KEYS.flat().map((k) => {
          if (k === "") return `<span></span>`;
          const cls = /^\d|^00$|^\.$/.test(k) ? "" :
            k === "=" ? "eq" : k === "AC" ? "fn danger" : ["+", "-", "×", "÷"].includes(k) ? "op" : "fn";
          const span = k === "=" ? ` style="grid-row: span 2"` : "";
          return `<button class="calc-key ${cls}" data-k="${k}"${span}>${k}</button>`;
        }).join("")}
      </div>
    </div>`;

  sheetEl.addEventListener("click", (e) => {
    const k = e.target.closest("[data-k]")?.dataset.k;
    if (k) press(k);
  });
  sheetEl.querySelector("#calc-close").onclick = closeCalc;
  fab.onclick = () => (sheetEl.hidden ? openCalc() : closeCalc());
  render();
}

export function openCalc() { sheetEl.hidden = false; render(); }
export function closeCalc() { sheetEl.hidden = true; }

/** 電卓単体画面（#calc）用: シートを常時表示扱いで開く */
export function renderCalcPage(container) {
  container.innerHTML = `
    <h1 class="page-title">電卓</h1>
    <p class="muted">本番のCBTでは持参した電卓を使います。ここでの操作に慣れておくと本番でも手が動きます。M+/M-はメモリ加減算、GTは「＝」の結果の合計です。</p>
    <div class="mt-16"><button class="btn btn-primary btn-block" id="open-calc">電卓を開く</button></div>`;
  container.querySelector("#open-calc").onclick = openCalc;
  openCalc();
}
