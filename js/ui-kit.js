// Small shared HTML builders. Every piece of user text goes through esc().

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const KANJI_NO = "一二三四五";

export function header(ui, actions = "") {
  const room = ui.roomCode && (ui.mode === "host" || ui.mode === "client")
    ? `<span class="chip gold">部屋 ${esc(ui.roomCode)}</span>`
    : "";
  return `<header class="bar">
    <div class="brand"><span class="seal" aria-hidden="true">運営委員会</span><span>性癖カードバトル <small>公式進行補助システム</small></span></div>
    <div class="bar-actions">${room}${actions}</div>
  </header>`;
}

export function connBanner(ui) {
  if (ui.mode === "client" && ui.conn === "lost") {
    return `<div class="conn-banner" role="status">司会者との接続が切れました。再接続しています…</div>`;
  }
  if (ui.mode === "client" && ui.conn === "failed") {
    return `<div class="conn-banner" role="alert">司会者に再接続できませんでした。
      <button class="btn btn-sm" data-action="retryJoin">もう一度つなぐ</button></div>`;
  }
  if (ui.mode === "host" && ui.conn !== "open") {
    return `<div class="conn-banner" role="status">部屋を準備しています…</div>`;
  }
  return "";
}

export const messages = (ui) => [
  ui.error ? `<div class="notice error" role="alert">${esc(ui.error)}</div>` : "",
  ui.info ? `<div class="notice" role="status">${esc(ui.info)}</div>` : "",
].join("");

function cardField(slot, kind, k, value) {
  const isTrue = kind === "truths";
  const id = `d${slot}${isTrue ? "t" : "l"}${k}`;
  return `<div class="field"><label class="${isTrue ? "tag-true" : "tag-false"}" for="${id}">${isTrue ? "真" : "偽"}${k + 1}</label>
    <input class="secret" id="${id}" data-draft="${slot}" data-kind="${kind}" data-k="${k}" value="${esc(value)}" autocomplete="off" maxlength="40"></div>`;
}

/** Card entry form bound to ui.drafts[slot]. */
export function cardForm(slot, draft, { title, nameEditable, fixedName = "" }) {
  const nameRow = nameEditable
    ? `<div class="field"><label class="tag-name" for="d${slot}name">名前</label>
        <input id="d${slot}name" data-draft="${slot}" data-kind="name" value="${esc(draft.name)}" placeholder="プレイヤー${slot + 1}" autocomplete="off" maxlength="16"></div>`
    : `<div class="field"><span class="tag-name">名前</span><strong>${esc(fixedName)}</strong></div>`;
  return `<div class="player-form">
    <h3>${esc(title)}</h3>
    ${nameRow}
    ${draft.truths.map((v, k) => cardField(slot, "truths", k, v)).join("")}
    ${draft.lies.map((v, k) => cardField(slot, "lies", k, v)).join("")}
  </div>`;
}

export function slotState(p) {
  if (!p.claimed) return `<span class="state wait">参加待ち</span>`;
  if (!p.connected) return `<span class="state lost">接続が切れています</span>`;
  if (p.submitted) return `<span class="state ready">入力済み</span>`;
  return `<span class="state wait">入力中…</span>`;
}

export function peopleList(people) {
  if (!people.length) return `<p class="waiting">まだいません</p>`;
  return `<ul class="people">${people.map((x) => `<li><span class="dot ${x.connected ? "on" : ""}"></span>${esc(x.name)}</li>`).join("")}</ul>`;
}
