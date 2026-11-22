// Peer-to-peer transport on top of PeerJS (loaded globally as window.Peer).
// The host's peer id is derived from the room code; everyone else connects to it.
//
// WebRTC rarely reports a peer that vanished (closed tab, phone put to sleep), so both
// sides exchange heartbeats and treat a silent connection as closed.

const PREFIX = "seiheki-cb-v1-";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;
const PING_MS = 4000;
const STALE_MS = 20000;
const PING = "ping";
const PONG = "pong";

export const peerAvailable = () => typeof window.Peer === "function";
export const isRoomCode = (code) => new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(code);

export function newRoomCode() {
  const bytes = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => ALPHABET[n % ALPHABET.length]).join("");
}

const isHeartbeat = (data, kind) => Boolean(data) && typeof data === "object" && data.t === kind;

/**
 * Open a room as host.
 * @param {string} code
 * @param {{ onOpen: () => void, onMessage: (peerId: string, msg: unknown) => void,
 *           onClose: (peerId: string) => void, onError: (err: { type?: string }) => void }} h
 */
export function hostRoom(code, h) {
  const peer = new window.Peer(PREFIX + code, { debug: 0 });
  const conns = new Map(); // peerId -> { conn, lastSeen }

  const drop = (peerId, conn) => {
    const entry = conns.get(peerId);
    if (!entry || entry.conn !== conn) return;
    conns.delete(peerId);
    try { conn.close(); } catch { /* already closed */ }
    h.onClose(peerId);
  };

  peer.on("open", () => h.onOpen());
  peer.on("connection", (conn) => {
    conn.on("open", () => conns.set(conn.peer, { conn, lastSeen: Date.now() }));
    conn.on("data", (data) => {
      const entry = conns.get(conn.peer);
      if (entry && entry.conn === conn) entry.lastSeen = Date.now();
      if (isHeartbeat(data, PING)) { if (conn.open) conn.send({ t: PONG }); return; }
      h.onMessage(conn.peer, data);
    });
    conn.on("close", () => drop(conn.peer, conn));
    conn.on("error", () => drop(conn.peer, conn));
  });
  peer.on("disconnected", () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on("error", (err) => h.onError(err));

  const sweeper = setInterval(() => {
    const now = Date.now();
    conns.forEach((entry, peerId) => { if (now - entry.lastSeen > STALE_MS) drop(peerId, entry.conn); });
  }, PING_MS);

  return {
    send(peerId, msg) {
      const entry = conns.get(peerId);
      if (entry && entry.conn.open) entry.conn.send(msg);
    },
    destroy() { clearInterval(sweeper); peer.destroy(); },
  };
}

/**
 * Join a room as a guest.
 * @param {string} code
 * @param {{ onSignal: () => void, onOpen: () => void, onMessage: (msg: unknown) => void,
 *           onClose: () => void, onError: (err: { type?: string }) => void }} h
 */
export function joinRoom(code, h) {
  const peer = new window.Peer({ debug: 0 });
  let conn = null;
  let closed = false;
  let lastHeard = 0;
  let pinger = null;

  const closeOnce = () => {
    if (closed) return;
    closed = true;
    clearInterval(pinger);
    h.onClose();
  };

  peer.on("open", () => {
    h.onSignal(); // reached the signaling server; now dialing the host directly
    conn = peer.connect(PREFIX + code, { reliable: true });
    conn.on("open", () => {
      lastHeard = Date.now();
      pinger = setInterval(() => {
        if (Date.now() - lastHeard > STALE_MS) { closeOnce(); return; }
        if (conn.open) conn.send({ t: PING });
      }, PING_MS);
      h.onOpen();
    });
    conn.on("data", (data) => {
      lastHeard = Date.now();
      if (isHeartbeat(data, PONG)) return;
      h.onMessage(data);
    });
    conn.on("close", closeOnce);
    conn.on("error", closeOnce);
  });
  peer.on("error", (err) => h.onError(err));

  return {
    send(msg) { if (conn && conn.open) conn.send(msg); },
    destroy() { closed = true; clearInterval(pinger); peer.destroy(); },
  };
}
