import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const DIR = dirname(fileURLToPath(import.meta.url));
const ENGINE_SRC = readFileSync(join(DIR, "engine.js"), "utf8");

function loadEngine() {
  const ctx = { TextEncoder, TextDecoder, Uint8Array, Int32Array, Math, Date, Array, Object, String };
  vm.createContext(ctx);
  vm.runInContext(ENGINE_SRC, ctx);
  return ctx;
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

test("battleship SHA-256 matches Node crypto byte-for-byte", () => {
  const eng = loadEngine();
  const sample = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22]);
  const got = Buffer.from(eng.sha256Bytes(sample));
  const want = createHash("sha256").update(sample).digest();
  assert.deepEqual(got, want);
});

test("battleship random fleet packs into 10 bytes and enforces no-corner-touching rule", () => {
  const eng = loadEngine();
  const fleet = eng.randomFleet();
  assert.ok(fleet && eng.validateFleet(fleet));
  const packed = eng.packFleet(fleet);
  assert.equal(packed.length, 10);
  const unpacked = eng.unpackFleet(packed);
  assert.ok(unpacked && unpacked.length === 10);

  // Corner-touching fleet must be rejected.
  const touching = [
    { x: 0, y: 0, len: 2, horiz: true },
    { x: 2, y: 1, len: 1, horiz: true },
  ];
  assert.equal(eng.canPlaceShip([touching[0]], touching[1], -1), false);
});

test("battleship wire packet sizes stay within 1 AES block for shots and results", () => {
  const eng = loadEngine();
  assert.equal(eng.encodeShot(0x1234, 1, 42).length, 6);
  assert.equal(eng.encodeResult(0x1234, 1, 42, eng.RES_MISS, 0, 0).length, 7);
  assert.equal(eng.encodeResult(0x1234, 1, 42, eng.RES_SUNK, 42, 2).length, 9);
  assert.equal(eng.encodeReady(0x1234, [1, 2, 3, 4, 5, 6, 7, 8]).length, 11);
  assert.equal(eng.encodeReveal(0x1234, new Array(10).fill(0), new Array(8).fill(1)).length, 21);
});

test("battleship full P2P match with auto-replies, sunk halos, commit-reveal verification, and resync", () => {
  const eng = loadEngine();
  const gid = 0x3333;
  const key = "g:3333";

  const fleetA = eng.randomFleet();
  const fleetB = eng.randomFleet();
  const bytesA = eng.packFleet(fleetA);
  const bytesB = eng.packFleet(fleetB);
  const saltA = [1, 2, 3, 4, 5, 6, 7, 8];
  const saltB = [8, 7, 6, 5, 4, 3, 2, 1];
  const commitA = eng.computeCommit8(bytesA, saltA);
  const commitB = eng.computeCommit8(bytesB, saltB);

  const alice = {
    [key]: {
      id: key, gameId: gid, peerPrefix: "bbbbbb000002", peerName: "Bob",
      myRole: "a", status: "invited_out",
      myReady: false, oppReady: false,
      myFleetBytes: null, mySalt: null, myCommit: null,
      oppCommit: null, oppFleetBytes: null, oppSalt: null, revealVerified: null,
      log: [], pendingShot: null, winner: null, finishAction: null, updatedAt: 1,
    },
  };
  const bob = {};

  exchange(eng, alice, bob, [{ to: "bob", payload: eng.encodeInvite(gid) }]);
  assert.equal(bob[key].status, "invited_in");

  bob[key].status = "setup";
  exchange(eng, alice, bob, [{ to: "alice", payload: eng.encodeAccept(gid) }]);
  assert.equal(alice[key].status, "setup");

  // Both lock in their fleets with SHA-256 commitments.
  alice[key].myFleetBytes = bytesA;
  alice[key].mySalt = saltA;
  alice[key].myCommit = commitA;
  alice[key].myReady = true;
  exchange(eng, alice, bob, [{ to: "bob", payload: eng.encodeReady(gid, commitA) }]);

  bob[key].myFleetBytes = bytesB;
  bob[key].mySalt = saltB;
  bob[key].myCommit = commitB;
  bob[key].myReady = true;
  bob[key].status = "playing";
  exchange(eng, alice, bob, [{ to: "alice", payload: eng.encodeReady(gid, commitB) }]);
  assert.equal(alice[key].status, "playing");
  assert.equal(bob[key].status, "playing");

  // Alice sinks all 20 cells of Bob's fleet sequentially (auto-reply gives Alice extra turns on every hit!).
  const targetsB = [];
  for (const s of fleetB) {
    for (const c of eng.shipCells(s)) targetsB.push(c);
  }
  assert.equal(targetsB.length, 20);

  for (const cell of targetsB) {
    const seq = alice[key].log.length + 1;
    alice[key].pendingShot = { seq, cell };
    exchange(eng, alice, bob, [{ to: "bob", payload: eng.encodeShot(gid, seq, cell) }]);
  }

  assert.equal(alice[key].status, "finished");
  assert.equal(alice[key].winner, "a");
  assert.equal(bob[key].status, "finished");
  assert.equal(bob[key].winner, "a");
  assert.equal(alice[key].revealVerified, "ok");
  assert.equal(bob[key].revealVerified, "ok");

  // Simulate Bob losing the last 5 log entries and Alice hitting Sync.
  bob[key].log = bob[key].log.slice(0, 15);
  bob[key].status = "playing";
  bob[key].winner = null;
  const syncPkts = eng.buildManualSyncPackets(alice[key]);
  exchange(eng, alice, bob, syncPkts.map((payload) => ({ to: "bob", payload })));
  assert.equal(bob[key].log.length, 20);
  assert.equal(bob[key].status, "finished");
  assert.equal(bob[key].winner, "a");
});

test("battleship detects cheated fleet reveal mismatch", () => {
  const eng = loadEngine();
  const fleetA = eng.randomFleet();
  const bytesA = eng.packFleet(fleetA);
  const salt = [1, 2, 3, 4, 5, 6, 7, 8];
  const commit = eng.computeCommit8(bytesA, salt);
  const g = {
    myRole: "a",
    oppCommit: commit,
    oppFleetBytes: bytesA.slice(),
    oppSalt: [9, 9, 9, 9, 9, 9, 9, 9], // wrong salt!
    log: [],
  };
  assert.equal(eng.verifyOpponentReveal(g), "mismatch");
});
