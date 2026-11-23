// Screens shown before a game view exists: title, rules, join form, connecting.
import { esc, header, messages } from "./ui-kit.js";

export const APP_VERSION = "2.2";
const CREATOR = { name: "ritolu", url: "https://github.com/ritolu" };
const COMMITTEE = "性癖カードバトル運営委員会";
const REPO_URL = "https://github.com/ritolu/seiheki-card-battle";

export function viewTitle(ui) {
  const resume = [
    ui.resume.host ? `<button class="btn" data-action="resumeHost">部屋 ${esc(ui.resume.host)} を再開（司会者）</button>` : "",
    ui.resume.client ? `<button class="btn" data-action="resumeClient">部屋 ${esc(ui.resume.client)} に戻る</button>` : "",
  ].join("");
  return `<section class="title-screen">
    <div class="title-stack">
      <span class="seal big" aria-hidden="true">運営委員会之印</span>
      <span class="eyebrow">紳士と紳士の熱きスポーツ</span>
      <h1 class="title-main">性癖カードバトル</h1>
      <p class="title-sub">真の性癖3つと偽りの性癖2つ。相手の説明を拝聴し、偽りを見破れ。</p>
      ${messages(ui)}
      <div class="title-actions">
        <button class="btn btn-primary btn-lg" data-action="createRoom">部屋を作る（司会者）</button>
        <button class="btn btn-lg" data-action="joinScreen">部屋に入る</button>
      </div>
      ${resume ? `<div class="title-minor">${resume}</div>` : ""}
      <div class="title-minor">
        <button class="btn btn-ghost" data-action="localGame">1台で遊ぶ（画面共有用）</button>
        <button class="btn btn-ghost" data-action="rules">ルールを読む</button>
        <button class="btn btn-ghost" data-action="credits">クレジット</button>
      </div>
      <span class="rev">ルールブック 令和8年5月12日改定版に準拠</span>
    </div>
  </section>
  <footer class="title-foot">© 2026 ${COMMITTEE}　製作 ${CREATOR.name}　v${APP_VERSION}</footer>`;
}

const creditRow = (role, names) => `<div class="credit-row"><dt>${role}</dt><dd>${names}</dd></div>`;
const extLink = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;

export function viewCredits(ui) {
  return `${header(ui, `<button class="btn" data-action="backTitle">タイトルへ戻る</button>`)}
  <section class="credits">
    <span class="seal big" aria-hidden="true">運営委員会之印</span>
    <h2 class="credits-title">性癖カードバトル</h2>
    <p class="credits-sub">公式進行補助システム　v${APP_VERSION}</p>
    <dl class="credit-list">
      ${creditRow("企画・ルール制定", COMMITTEE)}
      ${creditRow("製作", extLink(CREATOR.url, CREATOR.name))}
      ${creditRow("通信", `${extLink("https://peerjs.com/", "PeerJS")}<small>MIT License</small>`)}
      ${creditRow("中継サーバー", `${extLink("https://www.metered.ca/", "Metered")}<small>TURN Server</small>`)}
      ${creditRow("書体", `Shippori Mincho B1 ／ Zen Kaku Gothic New ／ Yuji Syuku<small>SIL Open Font License 1.1（Google Fonts）</small>`)}
    </dl>
    <div class="credit-license">
      <h3>ライセンス</h3>
      <p>プログラム：MIT License　© 2026 ${CREATOR.name}</p>
      <p>ゲームの名称・ルールブック・委員会名：© 2026 ${COMMITTEE}　All rights reserved.</p>
      <p>${extLink(REPO_URL, "ソースコードと変更履歴（GitHub）")}</p>
    </div>
    <p class="credit-disclaimer">本委員会は当作品におけるトラブルに一切の責任を負いかねます。</p>
    <span class="credit-seal" aria-hidden="true">${esc(COMMITTEE)}</span>
  </section>`;
}

export function viewRules(ui) {
  return `${header(ui, `<button class="btn" data-action="backTitle">タイトルへ戻る</button>`)}
  <div class="screen-head"><h2>ルールブック</h2><p>安心かつ公平なゲーム進行のために、始める前に全員で確認してください。</p></div>
  <div class="rules">
    <div class="rule-block"><h3>ゲームの概要</h3><ul>
      <li>討論者は己の真の性癖を3つ、偽りの性癖を2つ提示する。</li>
      <li>相手の性癖に対する説明を拝聴し、偽りの性癖を見破る。</li>
      <li>観戦者はミュートを徹底し、司会と討論者のみが発言可とする。</li>
      <li>相手の性癖を指摘する前に、5つのうち1つを「深掘り」できる。</li>
      <li>同点の場合は観戦者による異常性癖投票を行い、得票数の多い者を勝者とする。</li>
      <li>罰ゲームは優勝者が決定し、絶対遵守される。</li>
      <li>公平性のため司会者を設ける。通話に入室している者全員が参加者となり、参加義務を負う。</li>
    </ul></div>
    <div class="rule-block"><h3>このツールでの進め方</h3><ul>
      <li>司会者が「部屋を作る」で合言葉を発行し、通話で共有する。</li>
      <li>討論者2名は自分の端末でカードを提出する。真偽は司会者の端末だけが持つ。</li>
      <li>先攻はツールが抽選する。説明は片方ずつ行い、終わったら攻守交代。</li>
      <li>ダウトは各自2回まで。偽りを当てたら1点。深掘りは1回目のダウトの前に1回だけ。</li>
      <li>同点なら観戦者が自分の端末から投票する。同数なら再投票。</li>
      <li>押し間違えは司会者が「1手戻す」で取り消せる。</li>
    </ul></div>
    <div class="rule-block"><h3>プレイ人数</h3><dl>
      <dt>討論者</dt><dd>2名</dd><dt>司会者</dt><dd>1名</dd><dt>観戦者</dt><dd>奇数名（推奨）</dd>
    </dl></div>
    <div class="rule-block"><h3>注意事項</h3><ul>
      <li>信頼できる仲間とやりましょう。</li>
      <li>性的マイノリティや実在人物をネタにしないこと。</li>
      <li>相手が異常性癖の持ち主でも否定をしないこと。</li>
      <li>相手の性癖をカードバトル以外の場で持ち出さないこと。</li>
      <li>違反が見られる場合、罰則が課される場合があります。</li>
    </ul></div>
    <div class="rule-block"><h3>罰則</h3><dl>
      <dt>性癖開示ペナルティ</dt><dd>自分の「今後一切ネタにする予定のない性癖」を1つ発表する。</dd>
      <dt>視聴義務</dt><dd>己の性癖の範囲外の映像媒体を視聴する。</dd>
    </dl></div>
  </div>`;
}

export function viewJoin(ui) {
  const j = ui.join;
  const role = (value, label, note) => `<label><span><input type="radio" name="role" value="${value}" ${j.role === value ? "checked" : ""}> ${label}</span><small>${note}</small></label>`;
  return `${header(ui, `<button class="btn" data-action="backTitle">タイトルへ戻る</button>`)}
  <div class="screen-head"><h2>部屋に入る</h2><p>司会者から聞いた4文字の合言葉と、あなたの名前を入力してください。</p></div>
  <form class="join-form" id="joinForm" novalidate>
    ${messages(ui)}
    <div><label class="lbl" for="joinCode">合言葉</label>
      <input class="text-input code-input" id="joinCode" data-join="code" value="${esc(j.code)}" maxlength="4" autocomplete="off" autocapitalize="characters" inputmode="text" placeholder="7K3Q"></div>
    <div><label class="lbl" for="joinName">名前</label>
      <input class="text-input" id="joinName" data-join="name" value="${esc(j.name)}" maxlength="16" autocomplete="nickname" placeholder="通話での呼び名"></div>
    <div><span class="lbl">参加のしかた</span>
      <div class="role-pick" data-join="role">
        ${role("debater", "討論者", "カードを出して戦う（2名まで）")}
        ${role("spectator", "観戦者", "見守って、同点なら投票する")}
      </div></div>
    <button class="btn btn-primary btn-lg" type="submit">参加する</button>
  </form>`;
}

const JOIN_STEPS = [
  ["signal", "通信サーバーに接続"],
  ["dialing", "司会者の端末までの経路を作成"],
  ["hello", "参加を申し込み、返事を待つ"],
];

function joinSteps(stage) {
  const current = JOIN_STEPS.findIndex(([key]) => key === stage);
  const items = JOIN_STEPS.map(([, label], i) => {
    const state = i < current ? "done" : i === current ? "now" : "todo";
    const mark = state === "done" ? "✓" : state === "now" ? "…" : "・";
    return `<li class="step ${state}"><span aria-hidden="true">${mark}</span>${label}</li>`;
  }).join("");
  return `<ol class="join-steps" aria-label="接続の進み具合">${items}</ol>`;
}

export function viewConnecting(ui) {
  const text = ui.mode === "host" ? "部屋を準備しています…" : `部屋 ${esc(ui.roomCode)} に接続しています…`;
  const steps = ui.mode === "client" ? joinSteps(ui.joinStage) : "";
  return `${header(ui, `<button class="btn" data-action="leave">やめる</button>`)}
  <section class="draw">
    <div class="screen-head"><h2>${text}</h2><p>数秒かかることがあります。20秒たってもつながらない場合は、止まった段階をお知らせします。</p></div>
    ${steps}
    ${messages(ui)}
  </section>`;
}
