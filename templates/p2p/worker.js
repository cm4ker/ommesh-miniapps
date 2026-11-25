// Runs in an isolated Web Worker when a PEER_DATA packet arrives while the UI is closed.
// Op 1 = PING [1, seq(u16 LE)], Op 2 = PONG [2, seq(u16 LE)]
self.onPacket = function (input) {
  var p = input.packet.payload;
  if (!p || p.length < 3) return {};
  var op = p[0];
  var seq = p[1] | (p[2] << 8);
  var log = Array.isArray(input.storage && input.storage.log) ? input.storage.log.slice(-30) : [];
  var ru = input.locale === "ru";
  log.push({
    peer: input.packet.peerName,
    kind: op === 1 ? "PING" : "PONG",
    seq: seq,
    snr: input.packet.snr,
    at: Date.now()
  });
  var out = {
    storageSet: { log: log },
    activities: [
      {
        id: "peer:" + input.packet.peerPrefix,
        peerKeyPrefix: input.packet.peerPrefix,
        title: input.packet.peerName,
        subtitle: (op === 1 ? "PING" : "PONG") + " #" + seq,
        needsAttention: op === 1,
        updatedAt: Date.now()
      }
    ]
  };
  if (!input.packet.mirrored) {
    out.notify = {
      body: (op === 1 ? (ru ? "Получен PING #" : "Received PING #") : (ru ? "Получен PONG #" : "Received PONG #")) + seq,
      tag: "ping:" + input.packet.peerPrefix,
      peerPrefix: input.packet.peerPrefix
    };
    // Auto-reply with PONG in the background!
    if (op === 1) {
      out.send = [{ peerPrefix: input.packet.peerPrefix, payload: [2, seq & 0xff, (seq >> 8) & 0xff], retry: true }];
    }
  }
  return out;
};
