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

function sq(name) {
  const f = "abcdefgh".indexOf(name[0]);
  const r = Number(name[1]) - 1;
  return (r << 3) | f;
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

test("checkers dark-square bijection 0..31 <-> 0..63", () => {
  const eng = loadEngine();
  const seen = new Set();
  for (let i = 0; i < 32; i++) {
    const s64 = eng.sq32To64(i);
    assert.ok(eng.isDarkSq(s64));
    assert.equal(eng.sq64To32(s64), i);
    seen.add(s64);
  }
  assert.equal(seen.size, 32);
});

test("checkers initial setup has 12 white and 12 black men and 7 opening moves", () => {
  const eng = loadEngine();
  const pos = eng.initialState();
  const counts = eng.countPieces(pos.board);
  assert.equal(counts.wm, 12);
  assert.equal(counts.bm, 12);
  const moves = eng.legalMoves(pos);
  assert.equal(moves.length, 7);
});

test("checkers enforces mid-capture promotion to flying king and mandatory capture", () => {
  const eng = loadEngine();
  // White man on b6 jumps c7 -> d8 (promotes immediately to flying king!) and continues along d8-h4 diagonal over f6.
  const b = new Array(64).fill("");
  b[sq("b6")] = "M";
  b[sq("c7")] = "m";
  b[sq("f6")] = "m";
  b[sq("a1")] = "M"; // quiet white man must NOT be allowed to move while capture exists
  const pos = { board: b, turn: "w", quiet: 0, ply: 0 };
  const moves = Array.from(eng.legalMoves(pos));
  const paths = moves.map((m) => Array.from(m.path).map((s) => eng.sqName(s)).join(":")).sort();
  assert.deepEqual(paths, ["b6:d8:g5", "b6:d8:h4"]);

  const next = eng.applyLegalMove(pos, moves[0]);
  assert.equal(next.board[sq("c7")], "");
  assert.equal(next.board[sq("f6")], "");
  assert.equal(next.board[moves[0].path[2]], "K");
});

test("checkers enforces backward capture and Turkish strike (no flying back through captured piece)", () => {
  const eng = loadEngine();
  // White man on d6 can capture backward over c5 -> b4, OR forward over e7 -> f8 (stopping at f8 because e7 stays on board).
  const b = new Array(64).fill("");
  b[sq("d6")] = "M";
  b[sq("e7")] = "m";
  b[sq("c5")] = "m";
  const pos = { board: b, turn: "w", quiet: 0, ply: 0 };
  const moves = Array.from(eng.legalMoves(pos));
  const paths = moves.map((m) => Array.from(m.path).map((s) => eng.sqName(s)).join(":")).sort();
  assert.deepEqual(paths, ["d6:b4", "d6:f8"]);
});

test("checkers flying king must land on square that allows continuing capture", () => {
  const eng = loadEngine();
  const b = new Array(64).fill("");
  b[sq("a1")] = "K";
  b[sq("c3")] = "m";
  b[sq("f4")] = "m"; // reachable ONLY if king lands on e5 after jumping c3!
  const pos = { board: b, turn: "w", quiet: 0, ply: 0 };
  const moves = Array.from(eng.legalMoves(pos));
  const paths = moves.map((m) => Array.from(m.path).map((s) => eng.sqName(s)).join(":")).sort();
  assert.deepEqual(paths, ["a1:e5:g3", "a1:e5:h2"]);
});

test("checkers wire format fits single move in 8 bytes (1 AES block) and handles multi-jump chains", () => {
  const eng = loadEngine();
  const single = eng.encodeMovePkt(0x1234, 1, [eng.sq64To32(sq("c3")), eng.sq64To32(sq("d4"))], 0xab);
  assert.equal(single.length, 8);
  const dec1 = eng.decodePacket(single);
  assert.deepEqual(Array.from(dec1.move), [eng.sq64To32(sq("c3")), eng.sq64To32(sq("d4"))]);
  assert.equal(dec1.hash8, 0xab);

  const multi = eng.encodeMovePkt(0x1234, 5, [eng.sq64To32(sq("b6")), eng.sq64To32(sq("d8")), eng.sq64To32(sq("g5"))], 0xcd);
  assert.equal(multi.length, 10);
  const dec2 = eng.decodePacket(multi);
  assert.deepEqual(Array.from(dec2.move), [eng.sq64To32(sq("b6")), eng.sq64To32(sq("d8")), eng.sq64To32(sq("g5"))]);
  assert.equal(dec2.hash8, 0xcd);
});

test("checkers bidirectional P2P flow and resync", () => {
  const eng = loadEngine();
  const gid = 0x2222;
  const key = "g:2222";
  const alice = {
    [key]: {
      id: key, gameId: gid, peerPrefix: "bbbbbb000002", peerName: "Bob",
      myColor: "w", colorVerified: true, status: "invited_out", moves: [],
      drawOfferedBy: null, winner: null, finishAction: null, updatedAt: 1,
    },
  };
  const bob = {};

  exchange(eng, alice, bob, [{ to: "bob", payload: eng.encodeInvite(gid, "w") }]);
  assert.equal(bob[key].status, "invited_in");
  assert.equal(bob[key].myColor, "b");

  bob[key].status = "active";
  exchange(eng, alice, bob, [{ to: "alice", payload: eng.encodeAccept(gid, "b") }]);
  assert.equal(alice[key].status, "active");

  // Play 6 real moves via OP_MOVE.
  for (let i = 0; i < 6; i++) {
    const mover = i % 2 === 0 ? alice : bob;
    const target = i % 2 === 0 ? "bob" : "alice";
    const rep = eng.replayMoves(mover[key].moves);
    assert.ok(rep && rep.legal.length > 0);
    const chosen = rep.legal[0];
    const p32 = Array.from(chosen.path).map((s) => eng.sq64To32(s));
    mover[key].moves.push(p32);
    const nextRep = eng.replayMoves(mover[key].moves);
    const pkt = eng.encodeMovePkt(gid, mover[key].moves.length, p32, eng.posHash8(nextRep.pos));
    exchange(eng, alice, bob, [{ to: target, payload: pkt }]);
  }
  assert.equal(alice[key].moves.length, 6);
  assert.equal(bob[key].moves.length, 6);

  // Now simulate Bob missing the last 4 moves and Alice hitting Sync.
  bob[key].moves = bob[key].moves.slice(0, 2);
  const syncPkts = eng.buildManualSyncPackets(alice[key]);
  exchange(eng, alice, bob, syncPkts.map((payload) => ({ to: "bob", payload })));
  assert.equal(bob[key].moves.length, 6);
  assert.deepEqual(
    JSON.stringify(bob[key].moves),
    JSON.stringify(alice[key].moves),
  );
});
