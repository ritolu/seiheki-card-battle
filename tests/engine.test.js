import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, reduce, publicView, validateCards, resetConnections, slotOf as slotIndexOf, HOST, MAX_SPECTATORS } from "../js/engine.js";

const CARDS_A = { truths: ["メガネ", "低い声", "手の血管"], lies: ["図書館", "敬語"] };
const CARDS_B = { truths: ["袖まくり", "かすれ声", "万年筆"], lies: ["左利き", "うなじ"] };
const identity = () => 0.999; // shuffle keeps the original order with this random source

function apply(state, action) {
  const res = reduce(state, action);
  assert.equal(res.error, undefined, `unexpected error for ${action.type}: ${res.error}`);
  return res.state;
}

function lobbyWithPlayers() {
  let s = createGame("online");
  s = apply(s, { type: "join", clientId: "a", name: "A", wantRole: "debater" });
  s = apply(s, { type: "join", clientId: "b", name: "B", wantRole: "debater" });
  s = apply(s, { type: "join", clientId: "v1", name: "観戦1", wantRole: "spectator" });
  s = apply(s, { type: "join", clientId: "v2", name: "観戦2", wantRole: "spectator" });
  s = apply(s, { type: "submitCards", by: "a", ...CARDS_A });
  s = apply(s, { type: "submitCards", by: "b", ...CARDS_B });
  return s;
}

function battle() {
  let s = lobbyWithPlayers();
  s = apply(s, { type: "start", by: HOST, first: 0, random: identity });
  s = apply(s, { type: "revealDraw", by: HOST });
  return apply(s, { type: "beginBattle", by: HOST });
}

test("validateCards rejects empty and duplicate cards and trims text", () => {
  assert.match(validateCards(["", "x", "y"], ["z", "w"]).error, /1つ未入力/);
  assert.match(validateCards(["x", "x", "y"], ["z", "w"]).error, /同じ内容/);
  assert.deepEqual(validateCards([" a ", "b", "c"], ["d", "e"]).truths, ["a", "b", "c"]);
  assert.ok(validateCards("nope", []).error);
});

test("third debater becomes a spectator and reconnect keeps the slot", () => {
  let s = lobbyWithPlayers();
  const res = reduce(s, { type: "join", clientId: "c", name: "C", wantRole: "debater" });
  assert.match(res.info, /観戦者として参加/);
  assert.ok(res.state.spectators.c);
  s = apply(s, { type: "leave", clientId: "a" });
  assert.equal(s.players[0].connected, false);
  s = apply(s, { type: "join", clientId: "a", name: "", wantRole: "spectator" });
  assert.equal(s.players[0].connected, true);
  assert.equal(s.players[0].clientId, "a");
});

test("a new debater takes over a slot abandoned before submitting", () => {
  let s = createGame("online");
  s = apply(s, { type: "join", clientId: "a", name: "A", wantRole: "debater" });
  s = apply(s, { type: "join", clientId: "ghost", name: "テスト用タブ", wantRole: "debater" });
  s = apply(s, { type: "leave", clientId: "ghost" });
  s = apply(s, { type: "join", clientId: "friend", name: "友達", wantRole: "debater" });
  assert.equal(s.players[1].clientId, "friend");
  assert.equal(s.players[1].name, "友達");
  assert.equal(s.players[1].connected, true);
  assert.equal(s.spectators.friend, undefined);
});

test("a spectator who rejoins as debater moves into an open slot", () => {
  let s = createGame("online");
  s = apply(s, { type: "join", clientId: "f", name: "友達", wantRole: "spectator" });
  s = apply(s, { type: "join", clientId: "f", name: "友達", wantRole: "debater" });
  assert.equal(s.players[0].clientId, "f");
  assert.equal(Object.keys(s.spectators).length, 0);
  assert.equal(publicView(s, "f").role, "debater");
});

test("a spectator rejoining as debater stays a spectator when slots are taken", () => {
  let s = lobbyWithPlayers();
  s = apply(s, { type: "join", clientId: "v1", name: "観戦1", wantRole: "debater" });
  assert.ok(s.spectators.v1);
  assert.equal(slotIndexOf(s, "v1"), -1);
});

test("a slot whose holder already submitted is not taken over", () => {
  let s = createGame("online");
  s = apply(s, { type: "join", clientId: "a", name: "A", wantRole: "debater" });
  s = apply(s, { type: "join", clientId: "b", name: "B", wantRole: "debater" });
  s = apply(s, { type: "submitCards", by: "b", ...CARDS_B });
  s = apply(s, { type: "leave", clientId: "b" });
  const res = reduce(s, { type: "join", clientId: "c", name: "C", wantRole: "debater" });
  assert.match(res.info, /観戦者として参加/);
  assert.equal(res.state.players[1].clientId, "b");
});

test("lobby view shows a debater only their own cards", () => {
  const s = lobbyWithPlayers();
  const viewA = publicView(s, "a");
  assert.deepEqual(viewA.myCards.truths, CARDS_A.truths);
  assert.ok(!JSON.stringify(viewA).includes("袖まくり"));
  assert.equal(publicView(s, "v1").myCards, undefined);
  assert.ok(!JSON.stringify(publicView(s, HOST)).includes("メガネ"));
});

test("start requires both submissions and only the host", () => {
  let s = createGame("online");
  s = apply(s, { type: "join", clientId: "a", name: "A", wantRole: "debater" });
  assert.ok(reduce(s, { type: "start", by: HOST, first: 0 }).error);
  assert.ok(reduce(lobbyWithPlayers(), { type: "start", by: "a", first: 0 }).error);
});

test("battle view never exposes truth of unrevealed cards", () => {
  const s = battle();
  for (const viewer of [HOST, "a", "b", "v1"]) {
    const view = publicView(s, viewer);
    assert.ok(view.deck.every((c) => !("isTrue" in c)), `leak for ${viewer}`);
    assert.equal(view.deck.length, 5);
  }
});

test("only the challenger or host may deep-dive and doubt", () => {
  const s = battle(); // player 0 presents, player 1 ("b") challenges
  assert.ok(reduce(s, { type: "doubt", by: "a", i: 0 }).error);
  assert.ok(reduce(s, { type: "doubt", by: "v1", i: 0 }).error);
  assert.equal(reduce(s, { type: "doubt", by: "b", i: 0 }).error, undefined);
  assert.equal(reduce(s, { type: "doubt", by: HOST, i: 0 }).error, undefined);
  assert.ok(reduce(s, { type: "doubt", by: "b", i: 9 }).error);
});

test("deep dive is allowed once and only before the first doubt", () => {
  let s = battle();
  s = apply(s, { type: "deep", by: "b", i: 2 });
  assert.ok(reduce(s, { type: "deep", by: "b", i: 3 }).error);
  let t = battle();
  t = apply(t, { type: "doubt", by: "b", i: 0 });
  assert.ok(reduce(t, { type: "deep", by: "b", i: 1 }).error);
});

test("two doubts end the turn, score hits, reveal all, and undo restores", () => {
  let s = battle(); // deck order kept: indexes 3 and 4 are lies
  s = apply(s, { type: "doubt", by: "b", i: 3 });
  assert.deepEqual(s.scores, [0, 1]);
  s = apply(s, { type: "undo", by: HOST });
  assert.deepEqual(s.scores, [0, 0]);
  s = apply(s, { type: "doubt", by: "b", i: 3 });
  s = apply(s, { type: "doubt", by: "b", i: 0 });
  const view = publicView(s, "v1");
  assert.equal(view.turnState.done, true);
  assert.ok(view.deck.every((c) => c.revealed && "isTrue" in c));
  assert.equal(view.hits, 1);
  assert.ok(reduce(s, { type: "doubt", by: "b", i: 1 }).error);
});

test("tied scores go to a spectator vote with revote on a tie", () => {
  let s = battle();
  s = apply(s, { type: "doubt", by: "b", i: 0 });
  s = apply(s, { type: "doubt", by: "b", i: 1 });
  s = apply(s, { type: "nextTurn", by: HOST });
  s = apply(s, { type: "doubt", by: "a", i: 0 });
  s = apply(s, { type: "doubt", by: "a", i: 1 });
  s = apply(s, { type: "nextTurn", by: HOST });
  assert.equal(s.phase, "vote");
  assert.ok(reduce(s, { type: "vote", by: "a", target: 0 }).error, "debaters cannot vote");
  s = apply(s, { type: "vote", by: "v1", target: 0 });
  s = apply(s, { type: "vote", by: "v2", target: 1 });
  assert.equal(publicView(s, "v1").votes, undefined, "spectators do not see live counts");
  s = apply(s, { type: "tally", by: HOST });
  assert.equal(s.phase, "vote");
  assert.equal(s.voteRound, 2);
  s = apply(s, { type: "vote", by: "v1", target: 1 });
  s = apply(s, { type: "manualVote", by: HOST, target: 1, delta: 1 });
  s = apply(s, { type: "tally", by: HOST });
  assert.equal(s.phase, "result");
  assert.equal(publicView(s, "a").winner, 1);
});

test("again keeps players but clears their cards", () => {
  let s = battle();
  s = apply(s, { type: "doubt", by: "b", i: 3 });
  s = apply(s, { type: "doubt", by: "b", i: 4 });
  s = apply(s, { type: "nextTurn", by: HOST });
  s = apply(s, { type: "doubt", by: "a", i: 0 });
  s = apply(s, { type: "doubt", by: "a", i: 1 });
  s = apply(s, { type: "nextTurn", by: HOST });
  assert.equal(s.phase, "result");
  s = apply(s, { type: "again", by: HOST });
  assert.equal(s.phase, "lobby");
  assert.equal(s.players[0].clientId, "a");
  assert.equal(s.players[0].submitted, false);
  assert.deepEqual(s.scores, [0, 0]);
});

test("a guest cannot join with the host's id or prototype keys", () => {
  const s = createGame("online");
  assert.ok(reduce(s, { type: "join", clientId: HOST, name: "偽司会", wantRole: "spectator" }).error);
  for (const id of ["__proto__", "constructor", "toString"]) {
    const res = reduce(s, { type: "join", clientId: id, name: "", wantRole: "spectator" });
    assert.ok(res.error, `nameless join accepted for ${id}`);
  }
  assert.equal(publicView(s, "toString").role, "none");
});

test("prototype keys cannot vote", () => {
  let s = battle();
  s = apply(s, { type: "doubt", by: "b", i: 0 });
  s = apply(s, { type: "doubt", by: "b", i: 1 });
  s = apply(s, { type: "nextTurn", by: HOST });
  s = apply(s, { type: "doubt", by: "a", i: 0 });
  s = apply(s, { type: "doubt", by: "a", i: 1 });
  s = apply(s, { type: "nextTurn", by: HOST });
  assert.ok(reduce(s, { type: "vote", by: "constructor", target: 0 }).error);
});

test("spectators are capped", () => {
  let s = createGame("online");
  for (let i = 0; i < MAX_SPECTATORS; i++) s = apply(s, { type: "join", clientId: `v${i}`, name: `v${i}`, wantRole: "spectator" });
  assert.match(reduce(s, { type: "join", clientId: "extra", name: "x", wantRole: "spectator" }).error, /満員/);
});

test("resetConnections marks everyone offline", () => {
  const s = resetConnections(lobbyWithPlayers());
  assert.ok(s.players.every((p) => !p.connected));
  assert.ok(Object.values(s.spectators).every((v) => !v.connected));
  assert.equal(s.players[0].clientId, "a");
});

test("unknown actions are rejected", () => {
  assert.ok(reduce(createGame("online"), { type: "hack" }).error);
  assert.ok(reduce(createGame("online"), null).error);
});
