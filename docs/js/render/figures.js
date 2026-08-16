// figures.js — 図解DSL描画（DESIGN.md §4.5 が正本）
// SVGではなくHTML+CSSで描画する（拡大・折返し・アクセシビリティ重視）

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function yen(n) {
  return Number(n).toLocaleString("ja-JP");
}

/** 軽量Markdown: **強調**・「- 」箇条書き・改行のみ対応 */
export function mdLite(md) {
  const lines = String(md ?? "").split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("- ")) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(t.slice(2))}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (t) html += `<p>${inline(t)}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html;

  function inline(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }
}

export function renderFigure(fig) {
  const body = { journal, taccount, bspl, flow, worksheet }[fig.kind]?.(fig) ?? "";
  const cap = fig.caption ? `<div class="fig-caption">${esc(fig.caption)}</div>` : "";
  return `<figure class="fig">${body}${cap}</figure>`;
}

/** 仕訳表: rows: [{dr:[[科目,金額]...], cr:[[科目,金額]...]}] */
function journal(fig) {
  let rows = "";
  for (const r of fig.rows) {
    const n = Math.max(r.dr.length, r.cr.length);
    for (let i = 0; i < n; i++) {
      const d = r.dr[i], c = r.cr[i];
      rows += `<tr>
        <td>${d ? esc(d[0]) : ""}</td><td class="amt">${d ? yen(d[1]) : ""}</td>
        <td>${c ? esc(c[0]) : ""}</td><td class="amt">${c ? yen(c[1]) : ""}</td>
      </tr>`;
    }
  }
  return `<table class="fig-journal">
    <thead><tr><th class="dr" colspan="2">借方</th><th class="cr" colspan="2">貸方</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/** T字勘定: account, left:[[摘要,金額]], right:[[摘要,金額]] */
function taccount(fig) {
  const side = (items) => (items || []).map(([k, v]) =>
    `<div class="t-line"><span>${esc(k)}</span><span>${yen(v)}</span></div>`).join("");
  return `<div class="fig-taccount">
    <div class="acct-name">${esc(fig.account)}</div>
    <div class="t-body">
      <div class="t-side left">${side(fig.left)}</div>
      <div class="t-side">${side(fig.right)}</div>
    </div>
  </div>`;
}

/** B/S・P/Lボックス: chart:"bs"|"pl", left:[[名称,金額]], right:[[名称,金額]] */
function bspl(fig) {
  const cls = (name, sideIdx) => {
    if (fig.chart === "bs") return sideIdx === 0 ? "asset" : (name.includes("純資産") || name.includes("資本") ? "equity" : "liab");
    return sideIdx === 0 ? "exp" : "rev";
  };
  const col = (items, sideIdx) => (items || []).map(([k, v]) =>
    `<div class="cell ${cls(k, sideIdx)}" style="flex:${Math.max(1, Number(v) || 1)}">
       <span>${esc(k)}</span><span>${v != null ? yen(v) : ""}</span>
     </div>`).join("");
  return `<div class="fig-bspl">
    <div class="side">${col(fig.left, 0)}</div>
    <div class="side">${col(fig.right, 1)}</div>
  </div>`;
}

/** フロー図: nodes:[{id,label}], edges:[{from,to,label}] — 縦一列に描画 */
function flow(fig) {
  const arrow = `<svg viewBox="0 0 14 16"><path d="M7 1v11M3 9l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const nodeById = Object.fromEntries((fig.nodes || []).map((n) => [n.id, n]));
  const orderedIds = [];
  const edgeLabel = {};
  for (const e of fig.edges || []) {
    if (!orderedIds.includes(e.from)) orderedIds.push(e.from);
    if (!orderedIds.includes(e.to)) orderedIds.push(e.to);
    edgeLabel[`${e.from}->${e.to}`] = e.label || "";
  }
  for (const n of fig.nodes || []) if (!orderedIds.includes(n.id)) orderedIds.push(n.id);

  let html = "";
  orderedIds.forEach((id, i) => {
    html += `<div class="f-node">${esc(nodeById[id]?.label ?? id)}</div>`;
    if (i < orderedIds.length - 1) {
      const lbl = edgeLabel[`${id}->${orderedIds[i + 1]}`];
      html += `<div class="f-edge">${arrow}${lbl ? `<span>${esc(lbl)}</span>` : ""}</div>`;
    }
  });
  return `<div class="fig-flow">${html}</div>`;
}

/** 精算表など（v0.2で本格対応。暫定の簡易テーブル） */
function worksheet(fig) {
  const head = (fig.columns || []).map((c) => `<th>${esc(c)}</th>`).join("");
  const rows = (fig.rows || []).map((r) =>
    `<tr>${r.map((c, i) => `<td class="${i > 0 ? "amt" : ""}">${typeof c === "number" ? yen(c) : esc(c)}</td>`).join("")}</tr>`).join("");
  return `<div style="overflow-x:auto"><table class="fig-journal"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
