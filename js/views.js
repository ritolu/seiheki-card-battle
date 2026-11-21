// In-game screens, rendered from a view model (engine.publicView) plus local UI state.
// The view model never contains the truth of an unrevealed card, so nothing here can leak it.
import { DOUBT_LIMIT } from "./engine.js";
import { esc, header, connBanner, messages, cardForm, slotState, peopleList, KANJI_NO } from "./ui-kit.js";

const nm = (vm, i) => esc(vm.players[i].name);
const presenterOf = (vm) => vm.order[vm.turn];
const challengerOf = (vm) => vm.order[1 - vm.turn];
const isHost = (vm) => vm.role === "host";

function gameHeader(ui, vm) {
  const undo = isHost(vm) && vm.phase === "battle"
    ? `<button class="btn" data-action="undo" ${vm.canUndo ? "" : "disabled"}>1手戻す</button>` : "";
  const exit = isHost(vm) ? "中断" : "退出";
  return header(ui, `${undo}<button class="btn btn-ghost" data-action="askLeave">${exit}</button>`);
}

function confirmLeave(ui, vm) {
  if (!ui.confirmLeave) return "";
  const text = isHost(vm)
    ? (vm.mode === "online" ? "部屋を閉じてタイトルに戻りますか？ 参加者全員の接続が切れます。" : "ゲームを中断してタイトルに戻りますか？ 入力したカードと得点は消えます。")
    : "部屋から退出しますか？ 同じ合言葉で入り直せます。";
  return `<div class="notice error" role="alert"><strong>${text}</strong>
    <button class="btn btn-shu" data-action="leave">はい</button><button class="btn" data-action="cancelLeave">続ける</button></div>`;
}

// ---------- lobby ----------
function localLobby(ui) {
  return `<div class="screen-head"><h2>カード入力</h2><p>司会者が討論者2名からDMで受け取った性癖を入力します。表示はバトル開始時にシャッフルされます。</p></div>
  <div class="notice"><strong>入力中は画面共有を止めてください。</strong><span>伏せ字にしていても、入力中の欄だけは文字が見えます。</span></div>
  ${messages(ui)}
  <div class="input-grid ${ui.hide ? "hide-on" : ""}">
    ${cardForm(0, ui.drafts[0], { title: "プレイヤー1", nameEditable: true })}
    ${cardForm(1, ui.drafts[1], { title: "プレイヤー2", nameEditable: true })}
  </div>
  <div class="form-actions">
    <div class="chips">
      <button class="btn" data-action="toggleHide" aria-pressed="${ui.hide}">${ui.hide ? "伏せ字：オン" : "伏せ字：オフ"}</button>
      <button class="btn btn-ghost" data-action="sample">サンプルを入れる</button>
    </div>
    <button class="btn btn-primary btn-lg" data-action="localConfirm">確定して先攻を決める</button>
  </div>`;
}

function slotsPanel(vm) {
  const rows = vm.players.map((p, i) => `<div class="slot">
      <span class="dot ${p.claimed && p.connected ? "on" : ""}"></span>
      <span class="slot-name"><span class="slot-label">討論者${i + 1}</span>${p.claimed ? esc(p.name) : "—"}</span>
      ${slotState(p)}
      ${isHost(vm) && p.claimed ? `<button class="btn btn-sm btn-ghost" data-action="releaseSlot" data-i="${i}">枠を空ける</button>` : ""}
    </div>`).join("");
  return `<div class="panel"><h3>討論者</h3><div class="slots">${rows}</div>
    <h3 style="margin-top:18px">観戦者（${vm.spectators.length}人）</h3>${peopleList(vm.spectators)}</div>`;
}

function hostLobby(ui, vm) {
  const ready = vm.players.every((p) => p.submitted);
  return `<div class="screen-head"><h2>参加者を待っています</h2><p>合言葉か招待リンクを通話で共有してください。真偽は司会者の画面にも表示されないので、画面共有したままで大丈夫です。</p></div>
  ${messages(ui)}
  <div class="room-grid">
    <div class="panel"><h3>合言葉</h3>
      <div class="room-code" aria-label="合言葉">${esc(ui.roomCode)}</div>
      <div class="invite"><code>${esc(ui.inviteUrl)}</code>
        <button class="btn btn-sm" data-action="copyInvite">${ui.copied ? "コピーしました" : "リンクをコピー"}</button></div>
    </div>
    ${slotsPanel(vm)}
  </div>
  <div class="center-actions">
    <button class="btn btn-primary btn-lg" data-action="start" ${ready ? "" : "disabled"}>対戦開始（先攻を抽選）</button>
    ${ready ? "" : `<span class="waiting">討論者2名のカード提出を待っています</span>`}
  </div>`;
}

function debaterLobby(ui, vm) {
  const me = vm.players[vm.mySlot];
  if (vm.myCards.submitted && !ui.editing) {
    return `<div class="screen-head"><h2>カードを提出しました</h2><p>司会者が対戦を始めるまでお待ちください。開始前なら修正できます。</p></div>
    ${messages(ui)}
    <div class="center-actions"><button class="btn" data-action="editMine">カードを修正する</button></div>
    ${slotsPanel(vm)}`;
  }
  return `<div class="screen-head"><h2>あなたのカードを入力</h2><p>真の性癖3つと偽りの性癖2つ。提出した内容は司会者の端末だけに送られ、相手には見えません。</p></div>
  ${messages(ui)}
  <div class="input-grid ${ui.hide ? "hide-on" : ""}">
    ${cardForm(0, ui.drafts[0], { title: `討論者${vm.mySlot + 1}`, nameEditable: false, fixedName: me.name })}
    ${slotsPanel(vm)}
  </div>
  <div class="form-actions">
    <div class="chips">
      <button class="btn" data-action="toggleHide" aria-pressed="${ui.hide}">${ui.hide ? "伏せ字：オン" : "伏せ字：オフ"}</button>
      <button class="btn btn-ghost" data-action="sample">サンプルを入れる</button>
    </div>
    <button class="btn btn-primary btn-lg" data-action="submitMine">このカードで提出</button>
  </div>`;
}

function spectatorLobby(ui, vm) {
  return `<div class="screen-head"><h2>観戦者として参加中</h2><p>討論者のカードがそろうと、司会者が対戦を始めます。</p></div>
  ${messages(ui)}${slotsPanel(vm)}`;
}

function viewLobby(ui, vm) {
  if (vm.mode === "local") return localLobby(ui);
  if (isHost(vm)) return hostLobby(ui, vm);
  if (vm.role === "debater") return debaterLobby(ui, vm);
  return spectatorLobby(ui, vm);
}

// ---------- draw ----------
function viewDraw(ui, vm) {
  const plates = [0, 1].map((i) => {
    const first = vm.drawn && vm.order[0] === i;
    const role = vm.drawn ? (first ? "先攻" : "後攻") : "";
    return `<div class="plate ${first ? "lit" : ""}" data-plate="${i}"><span class="plate-role">${role}</span>${nm(vm, i)}</div>`;
  }).join("");
  const head = vm.drawn
    ? `<h2>先攻が決まりました</h2><p>${nm(vm, vm.order[0])}が先に5枚を説明し、${nm(vm, vm.order[1])}が見破ります。</p>`
    : `<h2>先攻を抽選中…</h2><p>公平な抽選を行っています。</p>`;
  const action = !vm.drawn ? "" : isHost(vm)
    ? `<button class="btn btn-primary btn-lg" data-action="beginBattle">バトル開始</button>`
    : `<p class="waiting">司会者がバトルを開始するのを待っています</p>`;
  return `<section class="draw"><div class="screen-head">${head}</div><div class="plates">${plates}</div>${action}</section>`;
}

// ---------- battle ----------
function scoreboard(vm) {
  const side = (i, align) => {
    const presenting = i === presenterOf(vm);
    const you = vm.mySlot === i ? "（あなた）" : "";
    const name = `<span class="sb-name"><span class="sb-role">${presenting ? "説明中" : "見破る側"}${you}</span>${nm(vm, i)}</span>`;
    const score = `<span class="sb-score" aria-label="${nm(vm, i)}の得点">${vm.scores[i]}</span>`;
    return `<div class="sb-side ${align} ${presenting ? "" : "active"}">${align === "right" ? score + name : name + score}</div>`;
  };
  return `<div class="scoreboard">${side(0, "left")}
    <div class="sb-mid"><b>${vm.turn === 0 ? "先攻ターン" : "後攻ターン"}</b><span>第${vm.turn + 1}ターン / 全2ターン</span></div>
    ${side(1, "right")}</div>`;
}

function cardStamp(card, doubted, anim) {
  if (!card.revealed) return { stamp: "", result: `<span class="card-result"></span>` };
  if (doubted && !card.isTrue) return { stamp: `<span class="stamp hit ${anim}">看破</span>`, result: `<span class="card-result hit">当たり！ 偽りの性癖</span>` };
  if (doubted) return { stamp: `<span class="stamp miss ${anim}">真</span>`, result: `<span class="card-result miss">ハズレ… 真の性癖</span>` };
  if (!card.isTrue) return { stamp: `<span class="stamp lie">偽</span>`, result: `<span class="card-result lie">見逃した偽り</span>` };
  return { stamp: `<span class="stamp truth">真</span>`, result: `<span class="card-result miss">真の性癖</span>` };
}

function cardView(vm, card, idx, showButtons, anim) {
  const t = vm.turnState;
  const doubted = t.doubts.includes(idx);
  const isDeep = t.deep === idx;
  const canDeep = vm.canAct && t.deep === null && t.doubts.length === 0;
  const canDoubt = vm.canAct && !doubted;
  const { stamp, result } = cardStamp(card, doubted, anim.has(idx) ? "anim" : "");
  const cls = ["card", isDeep ? "deep" : "", card.revealed ? `revealed ${card.isTrue ? "true" : "false"}` : ""].join(" ");
  const buttons = showButtons ? `<div class="card-btns">
      <button class="btn" data-action="deep" data-i="${idx}" ${canDeep ? "" : "disabled"}>深掘り</button>
      <button class="btn btn-shu" data-action="doubt" data-i="${idx}" ${canDoubt ? "" : "disabled"}>ダウト</button>
    </div>` : "";
  return `<article class="${cls}">
    <div class="card-face">
      <div class="card-no"><span>其の${KANJI_NO[idx]}</span>${isDeep ? `<span class="ribbon">深掘り</span>` : ""}</div>
      <div class="card-text">${esc(card.text)}</div>${stamp}
    </div>${result}${buttons}
  </article>`;
}

function battleGuide(vm) {
  const t = vm.turnState;
  const p = presenterOf(vm);
  const c = challengerOf(vm);
  const left = DOUBT_LIMIT - t.doubts.length;
  if (t.done) return `<p class="guide">ターン終了。<strong>${nm(vm, c)}</strong>は偽り2つのうち<strong>${vm.hits}つ</strong>を見破りました。</p>`;
  if (vm.mySlot === c) {
    return t.doubts.length === 0
      ? `<p class="guide you">あなたが見破る番です。深掘りを1回使ってから、偽りだと思うカードにダウトしてください。</p>`
      : `<p class="guide you">あなたのダウトはあと${left}回です。</p>`;
  }
  if (vm.mySlot === p) return `<p class="guide you">あなたの番です。5枚の性癖を説明してください。</p>`;
  if (t.doubts.length === 0) return `<p class="guide"><strong>${nm(vm, p)}</strong>が5枚を説明します。<strong>${nm(vm, c)}</strong>は深掘りを1回使ってから、偽りだと思うカードにダウトします。</p>`;
  return `<p class="guide"><strong>${nm(vm, c)}</strong>のダウトはあと${left}回です。</p>`;
}

function viewBattle(ui, vm, anim) {
  const t = vm.turnState;
  const left = DOUBT_LIMIT - t.doubts.length;
  let deepChip = `<span class="chip gold">深掘り：使用可（1回）</span>`;
  if (t.deep !== null) deepChip = `<span class="chip off">深掘り：其の${KANJI_NO[t.deep]}で使用済み</span>`;
  else if (t.doubts.length > 0) deepChip = `<span class="chip off">深掘り：使わずにダウト済み</span>`;
  const showButtons = isHost(vm) || vm.mySlot === challengerOf(vm);
  const next = vm.turn === 0 ? "攻守交代して後攻ターンへ" : "最終結果へ";
  const foot = !t.done ? "" : `<div class="turn-foot"><p>${nm(vm, challengerOf(vm))} に +${vm.hits} 点</p>${
    isHost(vm) ? `<button class="btn btn-primary btn-lg" data-action="nextTurn">${next}</button>` : `<span class="waiting">司会者の進行を待っています</span>`}</div>`;
  return `${scoreboard(vm)}
  <div class="status">${battleGuide(vm)}
    <div class="chips"><span class="chip ${left ? "gold" : "off"}">ダウト残り ${left} 回</span>${deepChip}</div></div>
  ${messages(ui)}
  <div class="cards">${vm.deck.map((card, i) => cardView(vm, card, i, showButtons, anim)).join("")}</div>
  ${foot}`;
}

// ---------- vote ----------
function hostVote(vm) {
  const box = (i) => `<div class="vote-box">
    <h3>${nm(vm, i)}</h3>
    <div class="vote-count" aria-live="polite">${vm.votes[i]}<small>票</small></div>
    <span class="vote-sub">うち手動 ${vm.manualVotes[i]} 票</span>
    <div class="vote-ctrl">
      <button class="btn" data-action="manualVote" data-i="${i}" data-d="-1" aria-label="${nm(vm, i)}の手動票を1減らす" ${vm.manualVotes[i] ? "" : "disabled"}>−</button>
      <button class="btn btn-primary" data-action="manualVote" data-i="${i}" data-d="1" aria-label="${nm(vm, i)}の手動票を1増やす">＋</button>
    </div></div>`;
  return `<div class="vote-grid">${box(0)}${box(1)}</div>
  <div class="center-actions"><span class="waiting">端末からの投票 ${vm.voterCount}人</span>
    <button class="btn btn-primary btn-lg" data-action="tally" ${vm.votes[0] + vm.votes[1] ? "" : "disabled"}>集計する</button></div>`;
}

function spectatorVote(vm) {
  const choice = (i) => `<button class="vote-choice ${vm.myVote === i ? "selected" : ""}" data-action="vote" data-i="${i}" aria-pressed="${vm.myVote === i}">
    ${nm(vm, i)}<small>${vm.myVote === i ? "あなたはこちらに投票しました" : "こちらに投票する"}</small></button>`;
  return `<div class="vote-grid">${choice(0)}${choice(1)}</div>
  <p class="waiting" style="text-align:center">投票は集計まで何度でも変えられます。投票済み ${vm.voterCount}人</p>`;
}

function viewVote(ui, vm) {
  const body = isHost(vm) ? hostVote(vm) : vm.role === "spectator" ? spectatorVote(vm)
    : `<p class="waiting" style="text-align:center">観戦者が投票中です。投票済み ${vm.voterCount}人</p>`;
  const how = vm.mode === "local" ? "司会者が票数を入力します。" : "観戦者は自分の端末から投票してください。通話のチャットなどで投票した人の分は、司会者が手動で足せます。";
  return `${finalBoard(vm)}
  <div class="screen-head"><h2>異常性癖投票${vm.voteRound > 1 ? `（${vm.voteRound}回目）` : ""}</h2>
    <p>得点は ${vm.scores[0]} 対 ${vm.scores[1]} で同点です。より異常だと思う討論者に投票してください。${how}</p></div>
  ${vm.notice ? `<div class="notice error" role="alert">${esc(vm.notice)}</div>` : ""}
  ${messages(ui)}${body}`;
}

function finalBoard(vm) {
  return `<div class="scoreboard">
    <div class="sb-side left"><span class="sb-name"><span class="sb-role">討論者1</span>${nm(vm, 0)}</span><span class="sb-score">${vm.scores[0]}</span></div>
    <div class="sb-mid"><b>最終得点</b><span>見破った偽りの数</span></div>
    <div class="sb-side right"><span class="sb-score">${vm.scores[1]}</span><span class="sb-name"><span class="sb-role">討論者2</span>${nm(vm, 1)}</span></div>
  </div>`;
}

// ---------- result ----------
function recapCol(vm, i) {
  const items = vm.recap[i].map((c) => {
    const mark = c.doubted ? (c.isTrue ? "ダウト（ハズレ）" : "看破") : "";
    return `<li><span class="tf ${c.isTrue ? "t" : "f"}">${c.isTrue ? "真" : "偽"}</span><span>${esc(c.text)}</span><span class="found">${mark}</span></li>`;
  }).join("");
  return `<div class="recap-col"><h3>${nm(vm, i)}の性癖</h3><p class="guide">${nm(vm, 1 - i)}のダウト結果つき</p><ol>${items}</ol></div>`;
}

function viewResult(ui, vm) {
  const how = vm.voted
    ? `得点 ${vm.scores[0]} 対 ${vm.scores[1]} の同点から、異常性癖投票 ${vm.votes[0]} 対 ${vm.votes[1]} 票で決着`
    : `得点 ${vm.scores[0]} 対 ${vm.scores[1]} で決着`;
  const actions = isHost(vm)
    ? `<button class="btn btn-primary btn-lg" data-action="again">同じメンバーでもう一度</button>
       <button class="btn btn-lg btn-ghost" data-action="askLeave">${vm.mode === "online" ? "部屋を閉じる" : "タイトルへ"}</button>`
    : `<p class="waiting">司会者が次のゲームを始めると、自動でカード入力に戻ります。</p>`;
  return `<section class="result-hero">
    <span class="eyebrow">優勝者</span>
    <h2 class="winner">${nm(vm, vm.winner)}</h2>
    <span class="win-stamp anim">優勝</span>
    <p class="guide">${esc(how)}。罰ゲームは優勝者が決定し、絶対遵守されます。</p>
    <div class="final">${actions}</div>
  </section>
  <div class="screen-head"><h2>振り返り</h2></div>
  <div class="recap">${recapCol(vm, 0)}${recapCol(vm, 1)}</div>`;
}

const PHASES = { lobby: viewLobby, draw: viewDraw, battle: viewBattle, vote: viewVote, result: viewResult };

/** @param {Set<number>} anim indexes of cards whose stamp should animate */
export function viewGame(ui, vm, anim) {
  const body = (PHASES[vm.phase] || viewLobby)(ui, vm, anim);
  return `${gameHeader(ui, vm)}${connBanner(ui)}${confirmLeave(ui, vm)}${body}`;
}
