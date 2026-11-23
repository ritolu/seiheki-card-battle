// Relay (TURN) servers used when two players' networks cannot connect directly.
// PeerJS's bundled relays no longer exist, so these come from our own Metered.ca app (Japan region).
// These credentials are public by nature: every visitor's browser receives them.
const METERED_USER = "49229d721b716875f7ff278e";
const METERED_PASS = "XrxQGBpS1Km+A5lW";

const relay = (urls) => ({ urls, username: METERED_USER, credential: METERED_PASS });

export const RELAY_SERVERS = [
  relay("turn:jp.relay.metered.ca:80"),
  relay("turn:jp.relay.metered.ca:80?transport=tcp"),
  relay("turn:jp.relay.metered.ca:443"),
  relay("turns:jp.relay.metered.ca:443?transport=tcp"),
];

export const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.relay.metered.ca:80" },
  ...RELAY_SERVERS,
];

// Add ?relay=1 to the URL to force every connection through the relay (for troubleshooting).
export const RELAY_ONLY = (() => {
  try { return new URLSearchParams(location.search).get("relay") === "1"; } catch { return false; }
})();
