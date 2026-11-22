// App controller: local UI state, host/guest networking, and rendering.
// The host keeps the authoritative game (engine.js) and sends each guest only publicView(game, guest).
import * as E from "./engine.js";
import { hostRoom, joinRoom, newRoomCode, isRoomCode, peerAvailable } from "./net.js";
import { viewTitle, viewRules, viewJoin, viewConnecting, viewCredits } from "./screens.js";
import { viewGame } from "./views.js";

const DRAW_MS = 1800;
const RETRY_MS = 3000;
const MAX_RECONNECT = 20;
const MAX_HOST_RETRY = 10;
const JOIN_TIMEOUT_MS = 20000;
const HELLO_RETRY_MS = 3000;
const JOIN_TIMEOUT_MESSAGES = {
  signal: "通信サーバーにつながりませんでした。ネットワークを確認して、もう一度「参加する」を押してください。",
  dialing: "司会者の端末までの経路を作れませんでした。回線の組み合わせが原因の可能性があります。もう一度試すか、別の回線（モバイル回線など）でお試しください。",
  hello: "司会者の端末にはつながりましたが、応答がありませんでした。司会者に部屋が開いたままか確認してもらい、もう一度お試しください。",
};
const KEY_HOST = "seiheki-host";
const KEY_CLIENT = "seiheki-client";
const KEY_ID = "seiheki-client-id";
const GUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const NO_PEER ="通信ライブラリを読み込めませんでした。ネットワークを確認して、ページを再読み込みしてください。";
const SAMPLE = [
  { name: "紳士A", truths: ["メガネを外す瞬間", "低めの落ち着いた声", "手の甲の血管"], lies: ["雨の日の図書館", "照れ隠しの敬語"] },
  { name: "紳士B", truths: ["袖をまくる仕草", "寝起きのかすれ声", "万年筆で書いた字"], lies: ["左利き", "うなじ"] },
];

// sessionStorage is per tab, so each tab is its own participant and survives a reload.
const store = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

const app = document.getElementById("app");
const clientId = store.get(KEY_ID) || (() => {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  store.set(KEY_ID, id);
  return id;
})();

const blankDraft = (name = "") => ({ name, truths: ["", "", ""], lies: ["", ""] });
const copyDraft = (d) => ({ name: d.name, truths: d.truths.slice(), lies: d.lies.slice() });
const isBlank = (d) => [...d.truths, ...d.lies].every((v) => !v);

function initialUi() {
  return {
    screen: "title", mode: null, roomCode: "", inviteUrl: "", conn: "idle",
    join: { code: "", name: store.get(KEY_CLIENT)?.name || "", role: "debater" },
    hide: true, drafts: [blankDraft(), blankDraft()], editing: false,
    error: "", info: "", copied: false, confirmLeave: false,
    resume: { host: store.get(KEY_HOST)?.code || "", client: store.get(KEY_CLIENT)?.code || "" },
  };
}

let ui = initialUi();
let game = null;   // authoritative state (host and local modes only)
let vm = null;     // view model on screen
let net = null;
const peerToClient = new Map();
let seenDoubts = null;
let drawSpin = null;
let drawTimer = null;
let reconnectTimer = null;
let joinTimer = null;
let helloTimer = null;
let reconnectTries = 0;
let hostRetries = 0;
let composing = false;
let pendingRender = false;

// ---------- rendering ----------
function stampAnimations() {
  const anim = new Set();
  if (!vm || vm.phase !== "battle") { seenDoubts = null; return anim; }
  const keys = vm.turnState.doubts.map((i) => `${vm.turn}-${i}`);
  if (seenDoubts) vm.turnState.doubts.forEach((i, k) => { if (!seenDoubts.has(keys[k])) anim.add(i); });
  seenDoubts = new Set(keys);
  return anim;
}

function screenHtml() {
  if (ui.screen === "rules") return viewRules(ui);
  if (ui.screen === "credits") return viewCredits(ui);
  if (ui.screen === "join") return viewJoin(ui);
  if (ui.screen === "connecting") return viewConnecting(ui);
  if (ui.screen === "game" && vm) return viewGame(ui, vm, stampAnimations());
  return viewTitle(ui);
}

function render() {
  if (composing) { pendingRender = true; return; } // never interrupt IME input
  const active = document.activeElement;
  const focusId = active && app.contains(active) ? active.id : "";
  let sel = null;
  try { sel = focusId ? [active.selectionStart, active.selectionEnd] : null; } catch { sel = null; }
  app.innerHTML = screenHtml();
  const el = focusId && document.getElementById(focusId);
  if (el) {
    el.focus();
    try { if (sel && sel[0] !== null) el.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ }
  }
  syncDrawSpin();
}

function setUi(patch) { ui = { ...ui, ...patch }; render(); }

function syncDrawSpin() {
  const spinning = ui.screen === "game" && vm && vm.phase === "draw" && !vm.drawn;
  if (!spinning) { clearInterval(drawSpin); drawSpin = null; return; }
  if (drawSpin || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let lit = 0;
  drawSpin = setInterval(() => {
    lit = 1 - lit;
    document.querySelectorAll("[data-plate]").forEach((p) => p.classList.toggle("lit", Number(p.dataset.plate) === lit));
  }, 120);
}

const scrollTop = () => { try { window.scrollTo({ top: 0 }); } catch { /* ignore */ } };
const inviteUrl = (code) => `${location.origin}${location.pathname}#join-${code}`;

function networkError(err) {
  const type = err && err.type;
  if (type === "browser-incompatible") return "このブラウザはオンライン対戦に対応していません。別のブラウザでお試しください。";
  if (["network", "server-error", "socket-error", "socket-closed"].includes(type)) {
    return "通信サーバーにつながりませんでした。ネットワークを確認して、もう一度お試しください。";
  }
  return `接続でエラーが発生しました（${type || "unknown"}）。もう一度お試しください。`;
}

// ---------- host ----------
function persistHost() { if (ui.mode === "host") store.set(KEY_HOST, { code: ui.roomCode, game }); }

function publish() {
  vm = E.publicView(game, E.HOST);
  if (net && ui.mode === "host") {
    peerToClient.forEach((cid, peerId) => net.send(peerId, { t: "state", view: E.publicView(game, cid) }));
  }
  render();
}

function scheduleDraw() {
  if (!game || game.phase !== "draw" || game.drawn || drawTimer) return;
  drawTimer = setTimeout(() => {
    drawTimer = null;
    if (game && game.phase === "draw") hostApply({ type: "revealDraw", by: E.HOST });
  }, DRAW_MS);
}

function hostApply(action) {
  const res = E.reduce(game, action);
  if (res.error) return res;
  game = res.state;
  persistHost();
  publish();
  scheduleDraw();
  return res;
}

function hostAct(type, extra = {}) {
  ui = { ...ui, error: "", info: "" };
  const res = hostApply({ type, by: E.HOST, ...extra });
  if (res.error) setUi({ error: res.error });
  return res;
}

function sanitizeGuestAction(a) {
  if (!a || typeof a !== "object") return null;
  if (a.type === "submitCards") return { type: a.type, truths: a.truths, lies: a.lies };
  if (a.type === "deep" || a.type === "doubt") return { type: a.type, i: Number(a.i) };
  if (a.type === "vote") return { type: a.type, target: Number(a.target) };
  return null;
}

function onGuestMessage(peerId, msg) {
  if (!msg || typeof msg !== "object" || !game) return;
  if (msg.t === "hello") {
    // Guest ids are namespaced so they can never equal E.HOST or an Object.prototype key.
    if (typeof msg.clientId !== "string" || !GUEST_ID.test(msg.clientId)) return;
    const cid = `g:${msg.clientId}`;
    const bound = peerToClient.get(peerId);
    if (bound && bound !== cid) return; // one connection = one participant
    const res = E.reduce(game, { type: "join", clientId: cid, name: msg.name, wantRole: msg.role === "debater" ? "debater" : "spectator" });
    if (res.error) { net.send(peerId, { t: "error", msg: res.error }); return; }
    peerToClient.forEach((c, pid) => { if (c === cid && pid !== peerId) peerToClient.delete(pid); });
    peerToClient.set(peerId, cid);
    game = res.state;
    persistHost();
    publish();
    if (res.info) net.send(peerId, { t: "info", msg: res.info });
    return;
  }
  if (msg.t === "action") {
    const cid = peerToClient.get(peerId);
    const action = sanitizeGuestAction(msg.action);
    if (!cid || !action) return;
    const res = hostApply({ ...action, by: cid });
    if (res.error) net.send(peerId, { t: "error", msg: res.error });
  }
}

function onGuestClose(peerId) {
  const cid = peerToClient.get(peerId);
  peerToClient.delete(peerId);
  const stillHere = [...peerToClient.values()].includes(cid);
  if (cid && !stillHere) hostApply({ type: "leave", clientId: cid });
}

function onHostError(err, code, resuming) {
  if (err && err.type === "unavailable-id") {
    if (net) net.destroy();
    net = null;
    if (!resuming) { startHosting(newRoomCode(), false); return; } // code collision: pick another
    if (hostRetries < MAX_HOST_RETRY) {
      hostRetries += 1;
      setUi({ info: `部屋 ${code} を取り戻しています…（${hostRetries}回目）` });
      setTimeout(() => startHosting(code, true), RETRY_MS);
      return;
    }
    setUi({ screen: "title", mode: null, conn: "idle", info: "", error: "前の部屋を再開できませんでした。新しく部屋を作ってください。" });
    return;
  }
  if (ui.conn !== "open") {
    if (net) net.destroy();
    net = null;
    setUi({ screen: "title", mode: null, conn: "idle", info: "", error: networkError(err) });
  }
}

function startHosting(code, resuming) {
  if (!peerAvailable()) { setUi({ error: NO_PEER }); return; }
  ui = { ...ui, mode: "host", roomCode: code, inviteUrl: inviteUrl(code), conn: "connecting", screen: "connecting", error: "" };
  render();
  net = hostRoom(code, {
    onOpen: () => {
      hostRetries = 0;
      ui = { ...ui, conn: "open", screen: "game", info: "" };
      persistHost();
      publish();
      scheduleDraw();
    },
    onMessage: onGuestMessage,
    onClose: onGuestClose,
    onError: (err) => onHostError(err, code, resuming),
  });
}

// ---------- guest ----------
function onHostMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.t === "state" && msg.view && typeof msg.view === "object") {
    clearJoinTimers();
    const prev = vm;
    vm = msg.view;
    let patch = { screen: "game", conn: "open" };
    if (vm.role === "debater" && vm.phase === "lobby") {
      if (prev && prev.phase !== "lobby") patch = { ...patch, drafts: [blankDraft(), ui.drafts[1]], editing: false };
      else if (vm.myCards && vm.myCards.submitted && isBlank(ui.drafts[0])) {
        patch = { ...patch, drafts: [{ name: "", truths: vm.myCards.truths, lies: vm.myCards.lies }, ui.drafts[1]] };
      }
    }
    ui = { ...ui, ...patch };
    render();
    return;
  }
  if (msg.t === "error") {
    const reopen = vm && vm.role === "debater" && vm.phase === "lobby";
    setUi({ error: E.cleanText(msg.msg, 200), info: "", editing: reopen ? true : ui.editing });
  }
  if (msg.t === "info") setUi({ info: E.cleanText(msg.msg, 200) });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (reconnectTries >= MAX_RECONNECT) { setUi({ conn: "failed" }); return; }
  reconnectTries += 1;
  reconnectTimer = setTimeout(() => {
    const saved = store.get(KEY_CLIENT);
    if (ui.mode !== "client" || !saved) return;
    startJoining(saved.code, saved.name, saved.role);
  }, RETRY_MS);
}

function clearJoinTimers() {
  clearTimeout(joinTimer);
  clearInterval(helloTimer);
  joinTimer = null;
  helloTimer = null;
}

function onJoinTimeout() {
  clearJoinTimers();
  if (ui.mode !== "client" || vm) return;
  if (net) net.destroy();
  net = null;
  setUi({ screen: "join", mode: null, conn: "idle", error: JOIN_TIMEOUT_MESSAGES[ui.joinStage] || JOIN_TIMEOUT_MESSAGES.signal });
}

function onGuestError(err) {
  clearJoinTimers();
  if (vm) { setUi({ conn: "lost" }); scheduleReconnect(); return; }
  if (net) net.destroy();
  net = null;
  const error = err && err.type === "peer-unavailable"
    ? "部屋が見つかりません。合言葉と、司会者が部屋を開いたままかを確認してください。"
    : networkError(err);
  setUi({ screen: "join", mode: null, conn: "idle", error });
}

function startJoining(code, name, role) {
  if (!peerAvailable()) { setUi({ error: NO_PEER }); return; }
  if (net) net.destroy();
  store.set(KEY_CLIENT, { code, name, role });
  const rejoining = Boolean(vm);
  clearJoinTimers();
  ui = { ...ui, mode: "client", roomCode: code, conn: rejoining ? "lost" : "connecting", screen: rejoining ? "game" : "connecting", joinStage: "signal", error: "", join: { ...ui.join, code, name, role } };
  render();
  if (!rejoining) joinTimer = setTimeout(onJoinTimeout, JOIN_TIMEOUT_MS);
  const hello = { t: "hello", clientId, name, role };
  net = joinRoom(code, {
    onSignal: () => { if (!vm) setUi({ joinStage: "dialing" }); },
    onOpen: () => {
      reconnectTries = 0;
      net.send(hello);
      // Joining is idempotent on the host, so resend until the first state arrives.
      clearInterval(helloTimer);
      helloTimer = setInterval(() => { if (net) net.send(hello); }, HELLO_RETRY_MS);
      if (!vm) setUi({ joinStage: "hello" });
    },
    onMessage: onHostMessage,
    onClose: () => { if (ui.mode !== "client") return; setUi({ conn: "lost" }); scheduleReconnect(); },
    onError: onGuestError,
  });
}

const sendAction = (action) => { if (net && ui.mode === "client") net.send({ t: "action", action }); };

// ---------- shared actions ----------
function leaveAll() {
  clearTimeout(reconnectTimer);
  clearJoinTimers();
  clearTimeout(drawTimer);
  drawTimer = null;
  if (net) net.destroy();
  net = null;
  peerToClient.clear();
  if (ui.mode === "host") store.del(KEY_HOST);
  if (ui.mode === "client") store.del(KEY_CLIENT);
  game = null;
  vm = null;
  seenDoubts = null;
  const name = ui.join.name;
  ui = initialUi();
  ui = { ...ui, join: { ...ui.join, name } };
  try { history.replaceState(null, "", location.pathname + location.search); } catch { /* ignore */ }
  render();
}

function localConfirm() {
  let next = game;
  for (const i of [0, 1]) {
    const d = ui.drafts[i];
    const res = E.reduce(next, { type: "submitCards", by: E.HOST, slot: i, name: d.name, truths: d.truths, lies: d.lies });
    if (res.error) { setUi({ error: `プレイヤー${i + 1}：${res.error}` }); return; }
    next = res.state;
  }
  game = next;
  hostAct("start", { first: Math.random() < 0.5 ? 0 : 1 });
  scrollTop();
}

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(ui.inviteUrl);
    setUi({ copied: true });
    setTimeout(() => setUi({ copied: false }), 2000);
  } catch {
    setUi({ info: "自動でコピーできませんでした。リンクを選択してコピーしてください。" });
  }
}

function battleAct(type, i) {
  if (ui.mode === "client") { ui = { ...ui, error: "" }; sendAction({ type, i }); return; }
  hostAct(type, { i });
}

const ACTIONS = {
  createRoom: () => { game = E.createGame("online"); hostRetries = 0; startHosting(newRoomCode(), false); },
  resumeHost: () => {
    const saved = store.get(KEY_HOST);
    if (!saved || !saved.game) { setUi({ error: "再開できる部屋がありません。", resume: { ...ui.resume, host: "" } }); return; }
    game = E.resetConnections(saved.game);
    hostRetries = 0;
    startHosting(saved.code, true);
  },
  joinScreen: () => setUi({ screen: "join", error: "", info: "" }),
  resumeClient: () => { const s = store.get(KEY_CLIENT); if (s) { reconnectTries = 0; startJoining(s.code, s.name, s.role); } },
  retryJoin: () => { const s = store.get(KEY_CLIENT); if (s) { reconnectTries = 0; startJoining(s.code, s.name, s.role); } },
  localGame: () => { game = E.createGame("local"); ui = { ...ui, mode: "local", screen: "game", error: "", info: "", drafts: [blankDraft(), blankDraft()] }; publish(); },
  rules: () => setUi({ screen: "rules" }),
  credits: () => { setUi({ screen: "credits" }); scrollTop(); },
  backTitle: () => setUi({ screen: "title", error: "", info: "" }),
  askLeave: () => setUi({ confirmLeave: true }),
  cancelLeave: () => setUi({ confirmLeave: false }),
  leave: leaveAll,
  toggleHide: () => setUi({ hide: !ui.hide }),
  sample: () => {
    if (ui.mode === "local") { setUi({ drafts: SAMPLE.map(copyDraft) }); return; }
    setUi({ drafts: [copyDraft(SAMPLE[vm && vm.mySlot === 1 ? 1 : 0]), ui.drafts[1]] });
  },
  copyInvite,
  localConfirm,
  submitMine: () => { const d = ui.drafts[0]; setUi({ editing: false, error: "" }); sendAction({ type: "submitCards", truths: d.truths, lies: d.lies }); },
  editMine: () => setUi({ editing: true, drafts: [{ name: "", truths: vm.myCards.truths.slice(), lies: vm.myCards.lies.slice() }, ui.drafts[1]] }),
  start: () => hostAct("start", { first: Math.random() < 0.5 ? 0 : 1 }),
  releaseSlot: (i) => hostAct("releaseSlot", { slot: i }),
  beginBattle: () => hostAct("beginBattle"),
  deep: (i) => battleAct("deep", i),
  doubt: (i) => battleAct("doubt", i),
  undo: () => hostAct("undo"),
  nextTurn: () => { hostAct("nextTurn"); scrollTop(); },
  vote: (i) => { setUi({ error: "" }); sendAction({ type: "vote", target: i }); },
  manualVote: (i, d) => hostAct("manualVote", { target: i, delta: d }),
  tally: () => hostAct("tally"),
  again: () => {
    if (ui.mode === "local") ui = { ...ui, drafts: ui.drafts.map((d) => blankDraft(d.name)) };
    hostAct("again");
    scrollTop();
  },
};

// ---------- events ----------
app.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn || btn.disabled) return;
  const fn = ACTIONS[btn.dataset.action];
  if (!fn) return;
  fn(btn.dataset.i !== undefined ? Number(btn.dataset.i) : undefined, btn.dataset.d !== undefined ? Number(btn.dataset.d) : undefined);
});

app.addEventListener("submit", (e) => {
  if (e.target.id !== "joinForm") return;
  e.preventDefault();
  const code = ui.join.code.trim().toUpperCase();
  const name = E.cleanText(ui.join.name, E.MAX_NAME);
  if (!isRoomCode(code)) { setUi({ error: "合言葉は4文字の英数字です（I・L・O・0・1は使われません）。" }); return; }
  if (!name) { setUi({ error: "名前を入力してください。" }); return; }
  reconnectTries = 0;
  vm = null;
  startJoining(code, name, ui.join.role);
});

// Typing updates state without re-rendering, so focus and IME composition stay intact.
app.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.draft !== undefined) {
    const slot = Number(el.dataset.draft);
    const kind = el.dataset.kind;
    const drafts = ui.drafts.map((d, k) => {
      if (k !== slot) return d;
      if (kind === "name") return { ...d, name: el.value };
      return { ...d, [kind]: d[kind].map((v, j) => (j === Number(el.dataset.k) ? el.value : v)) };
    });
    ui = { ...ui, drafts };
    return;
  }
  if (el.dataset.join) ui = { ...ui, join: { ...ui.join, [el.dataset.join]: el.value } };
});
app.addEventListener("change", (e) => { if (e.target.name === "role") ui = { ...ui, join: { ...ui.join, role: e.target.value } }; });
app.addEventListener("compositionstart", () => { composing = true; });
app.addEventListener("compositionend", () => { composing = false; if (pendingRender) { pendingRender = false; render(); } });

// ---------- boot ----------
const invited = location.hash.match(/^#join-([A-Za-z0-9]{4})$/);
if (invited) ui = { ...ui, screen: "join", join: { ...ui.join, code: invited[1].toUpperCase() } };
if (!peerAvailable()) ui = { ...ui, info: "通信ライブラリを読み込めなかったため、オンライン対戦は使えません。「1台で遊ぶ」は使えます。" };
render();
