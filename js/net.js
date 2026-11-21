// Peer-to-peer transport on top of PeerJS (loaded globally as window.Peer).
// The host's peer id is derived from the room code; everyone else connects to it.

const PREFIX = "seiheki-cb-v1-";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;

export const peerAvailable = () => typeof window.Peer === "function";
export const isRoomCode = (code) => new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(code);

export function newRoomCode() {
  const bytes = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => ALPHABET[n % ALPHABET.length]).join("");
}

/**
 * Open a room as host.
 * @param {string} code
 * @param {{ onOpen: () => void, onMessage: (peerId: string, msg: unknown) => void,
 *           onClose: (peerId: string) => void, onError: (err: { type?: string }) => void }} h
 */
export function hostRoom(code, h) {
  const peer = new window.Peer(PREFIX + code, { debug: 0 });
  const conns = new Map();

  peer.on("open", () => h.onOpen());
  peer.on("connection", (conn) => {
    conn.on("open", () => conns.set(conn.peer, conn));
    conn.on("data", (data) => h.onMessage(conn.peer, data));
    conn.on("close", () => {
      if (conns.get(conn.peer) !== conn) return;
      conns.delete(conn.peer);
      h.onClose(conn.peer);
    });
    conn.on("error", () => conn.close());
  });
  peer.on("disconnected", () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on("error", (err) => h.onError(err));

  return {
    send(peerId, msg) {
      const conn = conns.get(peerId);
      if (conn && conn.open) conn.send(msg);
    },
    destroy() { peer.destroy(); },
  };
}

/**
 * Join a room as a guest.
 * @param {string} code
 * @param {{ onOpen: () => void, onMessage: (msg: unknown) => void,
 *           onClose: () => void, onError: (err: { type?: string }) => void }} h
 */
export function joinRoom(code, h) {
  const peer = new window.Peer({ debug: 0 });
  let conn = null;
  let closed = false;
  const closeOnce = () => { if (!closed) { closed = true; h.onClose(); } };

  peer.on("open", () => {
    conn = peer.connect(PREFIX + code, { reliable: true });
    conn.on("open", () => h.onOpen());
    conn.on("data", (data) => h.onMessage(data));
    conn.on("close", closeOnce);
    conn.on("error", closeOnce);
  });
  peer.on("error", (err) => h.onError(err));

  return {
    send(msg) { if (conn && conn.open) conn.send(msg); },
    destroy() { closed = true; peer.destroy(); },
  };
}
