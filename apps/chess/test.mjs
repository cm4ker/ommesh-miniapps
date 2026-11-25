import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const DIR = dirname(fileURLToPath(import.meta.url));
const ENGINE_SRC = readFileSync(join(DIR, "engine.js"), "utf8");

function loadEngine() {
  const ctx = { TextEncoder, TextDecoder, Uint8Array, Math, Date, Array, Object, String };
  vm.createContext(ctx);
  vm.runInContext(ENGINE_SRC, ctx);
  return ctx;
}

function makeMoves(eng, plies) {
  const cycle = [
    eng.packMove(1, 18, 0, false),
    eng.packMove(57, 42, 0, false),
    eng.packMove(18, 1, 0, false),
    eng.packMove(42, 57, 0, false),
  ];
  return Array.from({ length: plies }, (_, i) => cycle[i % 4]);
}

function exchange(eng, alice, bob, queue, maxSteps = 40) {
  const q = [...queue];
  let steps = 0;
  while (q.length > 0) {
    assert.ok(steps < maxSteps, "sync loop exceeded step budget");
    steps++;
    const { to, payload } = q.shift();
    const res = eng.applyIncomingPacket(
      to === "alice" ? alice : bob,
      {
        peerPrefix: to === "alice" ? "bbbbbb000002" : "aaaaaa000001",
        peerName: to === "alice" ? "Bob" : "Alice",
        payload,
        timestamp: 1700000000 + steps,
        snr: 8,
        hops: null,
      },
      "en",
    );
    for (const r of res.replies) {
      q.push({ to: to === "alice" ? "bob" : "alice", payload: new Uint8Array(r.payload) });
    }
  }
  return steps;
}

test("chess bidirectional sync reconciles both sides and >72 ply games", () => {
  const eng = loadEngine();
  const full = makeMoves(eng, 90);
  const gid = 0x1010;
  const key = "g:1010";
  const alice = {
    [key]: {
      id: key, gameId: gid, peerPrefix: "bbbbbb000002", peerName: "Bob",
      myColor: "w", status: "active", moves: [...full],
      drawOfferedBy: null, winner: null, finishAction: null, updatedAt: 1,
    },
  };
  const bob = {
    [key]: {
      id: key, gameId: gid, peerPrefix: "aaaaaa000001", peerName: "Alice",
      myColor: "b", status: "active", moves: full.slice(0, 72),
      drawOfferedBy: null, winner: null, finishAction: null, updatedAt: 1,
    },
  };
  const pkts = eng.buildManualSyncPackets(alice[key]);
  exchange(eng, alice, bob, pkts.map((payload) => ({ to: "bob", payload })));
  assert.deepEqual(Array.from(bob[key].moves), full);
});
