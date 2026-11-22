// Game rules, owned by the host's browser. Pure functions only: no DOM, no network.
// Every change goes through reduce(state, action) and returns a new state object.

export const DOUBT_LIMIT = 2;
export const TRUTH_COUNT = 3;
export const LIE_COUNT = 2;
export const CARD_COUNT = TRUTH_COUNT + LIE_COUNT;
export const MAX_TEXT = 40;
export const MAX_NAME = 16;
export const HOST = "host";
export const MAX_SPECTATORS = 50;

// Participant ids come from the network; never trust the prototype chain when looking them up.
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isGuestId = (id) => typeof id === "string" && id !== HOST && id.length > 0 && id.length <= 80;

const newTurn = () => ({ deep: null, doubts: [], done: false });
const blankCards = () => ({ truths: Array(TRUTH_COUNT).fill(""), lies: Array(LIE_COUNT).fill("") });
const newSlot = () => ({ name: "", clientId: null, connected: false, submitted: false, ...blankCards() });

export function createGame(mode) {
  return {
    mode, // "local" (one screen) or "online" (host + peers)
    phase: "lobby",
    players: [newSlot(), newSlot()],
    spectators: {},
    ...freshRound(),
  };
}

function freshRound() {
  return {
    order: [0, 1],
    drawn: false,
    turn: 0,
    decks: [[], []],
    turns: [newTurn(), newTurn()],
    scores: [0, 0],
    manualVotes: [0, 0],
    spectatorVotes: {},
    voteRound: 1,
    voted: false,
    notice: "",
    undo: [],
  };
}

export function cleanText(value, max) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

export function shuffle(list, random = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function validateCards(truths, lies) {
  if (!Array.isArray(truths) || !Array.isArray(lies) || truths.length !== TRUTH_COUNT || lies.length !== LIE_COUNT) {
    return { error: "カードの形式が正しくありません。" };
  }
  const t = truths.map((v) => cleanText(v, MAX_TEXT));
  const l = lies.map((v) => cleanText(v, MAX_TEXT));
  const all = [...t, ...l];
  const empty = all.filter((v) => !v).length;
  if (empty) return { error: `性癖があと${empty}つ未入力です。` };
  if (new Set(all).size !== all.length) return { error: "同じ内容のカードがあります。" };
  return { truths: t, lies: l };
}

export const presenter = (s) => s.order[s.turn];
export const challenger = (s) => s.order[1 - s.turn];
export const slotOf = (s, clientId) => (clientId ? s.players.findIndex((p) => p.clientId === clientId) : -1);
export const nameOf = (s, i) => s.players[i].name || `プレイヤー${i + 1}`;
const isCardIndex = (i) => Number.isInteger(i) && i >= 0 && i < CARD_COUNT;
const isSide = (i) => i === 0 || i === 1;

export function voteTotals(s) {
  const online = [0, 0];
  Object.values(s.spectatorVotes).forEach((v) => { if (isSide(v)) online[v] += 1; });
  return [s.manualVotes[0] + online[0], s.manualVotes[1] + online[1]];
}

export function winnerIndex(s) {
  if (s.scores[0] !== s.scores[1]) return s.scores[0] > s.scores[1] ? 0 : 1;
  const [a, b] = voteTotals(s);
  return a > b ? 0 : 1;
}

const ok = (state, info = "") => ({ state, info });
const fail = (state, error) => ({ state, error });
const withSlot = (s, i, patch) => s.players.map((p, k) => (k === i ? { ...p, ...patch } : p));
const withCurrentTurn = (s, next) => s.turns.map((t, i) => (i === presenter(s) ? next : t));

// ---------- participants ----------
// An empty slot first; otherwise one whose holder left before submitting cards.
function openDebaterSlot(s) {
  if (s.phase !== "lobby") return -1;
  const free = s.players.findIndex((p) => !p.clientId && !p.submitted);
  if (free >= 0) return free;
  return s.players.findIndex((p) => p.clientId && !p.connected && !p.submitted);
}

function join(s, { clientId, name, wantRole }) {
  const cleanName = cleanText(name, MAX_NAME);
  if (!isGuestId(clientId)) return fail(s, "参加情報が正しくありません。");
  const mine = slotOf(s, clientId);
  if (mine >= 0) return ok({ ...s, players: withSlot(s, mine, { connected: true }) });
  const slot = wantRole === "debater" ? openDebaterSlot(s) : -1;
  if (has(s.spectators, clientId)) {
    const me = s.spectators[clientId];
    if (slot < 0) return ok({ ...s, spectators: { ...s.spectators, [clientId]: { ...me, connected: true } } });
    // A spectator who rejoins asking to debate moves into the open slot.
    const spectators = { ...s.spectators };
    delete spectators[clientId];
    return ok({ ...s, spectators, players: withSlot(s, slot, { ...newSlot(), clientId, name: cleanName || me.name, connected: true }) });
  }
  if (!cleanName) return fail(s, "名前を入力してください。");
  if (slot >= 0) return ok({ ...s, players: withSlot(s, slot, { ...newSlot(), clientId, name: cleanName, connected: true }) });
  if (Object.keys(s.spectators).length >= MAX_SPECTATORS) return fail(s, "観戦者が満員のため参加できません。");
  const info = wantRole === "debater"
    ? "討論者の枠が埋まっているため、観戦者として参加しました。討論者になるには、司会者に「枠を空ける」を押してもらってから入り直してください。"
    : "";
  return ok({ ...s, spectators: { ...s.spectators, [clientId]: { name: cleanName, connected: true } } }, info);
}

function leave(s, { clientId }) {
  const mine = slotOf(s, clientId);
  if (mine >= 0) return ok({ ...s, players: withSlot(s, mine, { connected: false }) });
  if (!has(s.spectators, clientId)) return ok(s);
  return ok({ ...s, spectators: { ...s.spectators, [clientId]: { ...s.spectators[clientId], connected: false } } });
}

/** After a host reload nobody is connected until they say hello again. */
export function resetConnections(s) {
  const spectators = {};
  Object.keys(s.spectators).forEach((id) => { spectators[id] = { ...s.spectators[id], connected: false }; });
  return { ...s, spectators, players: s.players.map((p) => ({ ...p, connected: false })) };
}

function releaseSlot(s, { by, slot }) {
  if (by !== HOST || s.phase !== "lobby" || !isSide(slot)) return fail(s, "今は枠を空けられません。");
  const p = s.players[slot];
  const spectators = p.clientId ? { ...s.spectators, [p.clientId]: { name: p.name, connected: p.connected } } : s.spectators;
  return ok({ ...s, spectators, players: withSlot(s, slot, newSlot()) });
}

// ---------- lobby ----------
function submitCards(s, { by, slot, name, truths, lies }) {
  if (s.phase !== "lobby") return fail(s, "対戦が始まっているため、カードは変更できません。");
  const target = by === HOST ? slot : slotOf(s, by);
  if (!isSide(target)) return fail(s, "討論者だけがカードを提出できます。");
  const cards = validateCards(truths, lies);
  if (cards.error) return fail(s, cards.error);
  const patch = { truths: cards.truths, lies: cards.lies, submitted: true };
  if (by === HOST && name !== undefined) patch.name = cleanText(name, MAX_NAME);
  return ok({ ...s, players: withSlot(s, target, patch) });
}

function buildDeck(p, random) {
  return shuffle([
    ...p.truths.map((text) => ({ text, isTrue: true })),
    ...p.lies.map((text) => ({ text, isTrue: false })),
  ], random);
}

function start(s, { by, first, random = Math.random }) {
  if (by !== HOST || s.phase !== "lobby") return fail(s, "今は対戦を始められません。");
  if (!s.players.every((p) => p.submitted)) return fail(s, "両者のカードがそろっていません。");
  const f = isSide(first) ? first : 0;
  return ok({
    ...s,
    ...freshRound(),
    phase: "draw",
    order: [f, 1 - f],
    decks: [buildDeck(s.players[0], random), buildDeck(s.players[1], random)],
  });
}

// ---------- battle ----------
const canAct = (s, by) => by === HOST || (by && slotOf(s, by) === challenger(s));

function deep(s, { by, i }) {
  const t = s.turns[presenter(s)];
  if (s.phase !== "battle" || !canAct(s, by) || !isCardIndex(i)) return fail(s, "今は深掘りできません。");
  if (t.deep !== null || t.doubts.length > 0 || t.done) return fail(s, "深掘りは1回目のダウトの前に1回だけです。");
  return ok({ ...s, undo: [...s.undo, { turns: s.turns, scores: s.scores }], turns: withCurrentTurn(s, { ...t, deep: i }) });
}

function doubt(s, { by, i }) {
  const t = s.turns[presenter(s)];
  if (s.phase !== "battle" || !canAct(s, by) || !isCardIndex(i)) return fail(s, "今はダウトできません。");
  if (t.done || t.doubts.includes(i)) return fail(s, "そのカードにはダウトできません。");
  const doubts = [...t.doubts, i];
  const hit = !s.decks[presenter(s)][i].isTrue;
  const scores = s.scores.map((v, k) => (hit && k === challenger(s) ? v + 1 : v));
  return ok({
    ...s,
    undo: [...s.undo, { turns: s.turns, scores: s.scores }],
    scores,
    turns: withCurrentTurn(s, { ...t, doubts, done: doubts.length >= DOUBT_LIMIT }),
  });
}

function undo(s, { by }) {
  if (by !== HOST || s.phase !== "battle" || !s.undo.length) return fail(s, "取り消せる操作がありません。");
  const prev = s.undo[s.undo.length - 1];
  return ok({ ...s, turns: prev.turns, scores: prev.scores, undo: s.undo.slice(0, -1) });
}

function nextTurn(s, { by }) {
  if (by !== HOST || s.phase !== "battle" || !s.turns[presenter(s)].done) return fail(s, "まだターンが終わっていません。");
  if (s.turn === 0) return ok({ ...s, turn: 1, undo: [] });
  const tie = s.scores[0] === s.scores[1];
  return ok({ ...s, phase: tie ? "vote" : "result", undo: [] });
}

// ---------- vote ----------
function vote(s, { by, target }) {
  if (s.phase !== "vote" || !has(s.spectators, by) || !isSide(target)) return fail(s, "投票できるのは観戦者だけです。");
  return ok({ ...s, spectatorVotes: { ...s.spectatorVotes, [by]: target } });
}

function manualVote(s, { by, target, delta }) {
  if (by !== HOST || s.phase !== "vote" || !isSide(target) || (delta !== 1 && delta !== -1)) return fail(s, "票数を変更できません。");
  return ok({ ...s, manualVotes: s.manualVotes.map((v, k) => (k === target ? Math.max(0, v + delta) : v)) });
}

function tally(s, { by }) {
  if (by !== HOST || s.phase !== "vote") return fail(s, "今は集計できません。");
  const [a, b] = voteTotals(s);
  if (a + b === 0) return fail(s, "まだ票が入っていません。");
  if (a === b) {
    return ok({ ...s, manualVotes: [0, 0], spectatorVotes: {}, voteRound: s.voteRound + 1, notice: `${a}対${b}の同数でした。再投票してください。` });
  }
  return ok({ ...s, phase: "result", voted: true, notice: "" });
}

// ---------- flow ----------
function simple(s, { by }, from, patch, error) {
  if (by !== HOST || !from(s)) return fail(s, error);
  return ok({ ...s, ...patch });
}

function again(s, { by }) {
  if (by !== HOST || s.phase !== "result") return fail(s, "今は次のゲームを始められません。");
  const players = s.players.map((p) => ({ ...p, ...blankCards(), submitted: false }));
  return ok({ ...s, ...freshRound(), phase: "lobby", players });
}

const REDUCERS = {
  join, leave, releaseSlot, submitCards, start, deep, doubt, undo, nextTurn, vote, manualVote, tally, again,
  revealDraw: (s, a) => simple(s, a, (x) => x.phase === "draw" && !x.drawn, { drawn: true }, "抽選中ではありません。"),
  beginBattle: (s, a) => simple(s, a, (x) => x.phase === "draw" && x.drawn, { phase: "battle", turn: 0, undo: [] }, "まだ抽選が終わっていません。"),
};

export function reduce(state, action) {
  const fn = action && REDUCERS[action.type];
  if (!fn) return fail(state, "不明な操作です。");
  return fn(state, action);
}

// ---------- what each person may see ----------
function roleOf(s, viewer) {
  if (viewer === HOST) return { role: "host", mySlot: -1 };
  const mySlot = slotOf(s, viewer);
  if (mySlot >= 0) return { role: "debater", mySlot };
  return { role: has(s.spectators, viewer) ? "spectator" : "none", mySlot: -1 };
}

function battleView(s, viewer, mySlot) {
  const p = presenter(s);
  const t = s.turns[p];
  const deck = s.decks[p].map((c, i) => {
    const revealed = t.doubts.includes(i) || t.done;
    return revealed ? { text: c.text, revealed: true, isTrue: c.isTrue } : { text: c.text, revealed: false };
  });
  const isChallenger = mySlot >= 0 && mySlot === challenger(s);
  return {
    deck,
    turnState: { deep: t.deep, doubts: t.doubts.slice(), done: t.done },
    hits: t.doubts.filter((i) => !s.decks[p][i].isTrue).length,
    canAct: !t.done && (viewer === HOST || isChallenger),
    canUndo: viewer === HOST && s.undo.length > 0,
  };
}

export function publicView(s, viewer) {
  const { role, mySlot } = roleOf(s, viewer);
  const view = {
    mode: s.mode,
    phase: s.phase,
    role,
    mySlot,
    players: s.players.map((p, i) => ({
      name: nameOf(s, i),
      claimed: Boolean(p.clientId) || s.mode === "local",
      connected: p.connected || s.mode === "local",
      submitted: p.submitted,
    })),
    spectators: Object.values(s.spectators).map((x) => ({ name: x.name, connected: x.connected })),
    order: s.order.slice(),
    drawn: s.drawn,
    turn: s.turn,
    scores: s.scores.slice(),
    voteRound: s.voteRound,
    voted: s.voted,
    notice: s.notice,
  };
  if (role === "debater" && s.phase === "lobby") {
    const me = s.players[mySlot];
    view.myCards = { truths: me.truths.slice(), lies: me.lies.slice(), submitted: me.submitted };
  }
  if (s.phase === "battle") Object.assign(view, battleView(s, viewer, mySlot));
  if (s.phase === "vote") {
    view.voterCount = Object.keys(s.spectatorVotes).length;
    view.myVote = has(s.spectatorVotes, viewer) && isSide(s.spectatorVotes[viewer]) ? s.spectatorVotes[viewer] : null;
    if (role === "host") { view.votes = voteTotals(s); view.manualVotes = s.manualVotes.slice(); }
  }
  if (s.phase === "result") {
    view.winner = winnerIndex(s);
    view.votes = voteTotals(s);
    view.recap = [0, 1].map((i) => s.decks[i].map((c, k) => ({ text: c.text, isTrue: c.isTrue, doubted: s.turns[i].doubts.includes(k) })));
  }
  return view;
}
