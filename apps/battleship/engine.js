var OP_INVITE = 1, OP_ACCEPT = 2, OP_DECLINE = 3, OP_READY = 4, OP_SHOT = 5, OP_RESULT = 6, OP_ACTION = 7, OP_CHAT = 8, OP_REVEAL = 9, OP_SYNC_REQ = 10, OP_SYNC_LOG = 11;
var RES_MISS = 0, RES_HIT = 1, RES_SUNK = 2, RES_WIN = 3;
var ACT_RESIGN = 1;
var MAX_CHAT_UTF8 = 147;
var MAX_SYNC_LOG_ENTRIES = 48;
var SYNC_FLAG_READY = 1, SYNC_FLAG_FINISHED = 2, SYNC_FLAG_HAS_ROLE = 4, SYNC_FLAG_IS_B = 8, SYNC_FLAG_OPP_READY = 16;
var HDR_HAS_ROLE = 0x20, HDR_IS_B = 0x40, HDR_MORE = 0x80;

var FLEET_LENS = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
var COLS_RU = "АБВГДЕЖЗИК";
var COLS_EN = "ABCDEFGHIJ";

function oppRole(r) {
  return r === "a" ? "b" : "a";
}

function cellName(cell, locale) {
  var x = cell % 10;
  var y = Math.floor(cell / 10);
  var cols = locale === "ru" ? COLS_RU : COLS_EN;
  return cols[x] + String(y + 1);
}

function shipCells(ship) {
  var out = [];
  for (var i = 0; i < ship.len; i++) {
    var x = ship.x + (ship.horiz ? i : 0);
    var y = ship.y + (ship.horiz ? 0 : i);
    out.push(y * 10 + x);
  }
  return out;
}

function canPlaceShip(ships, candidate, ignoreIdx) {
  if (!candidate || candidate.len < 1 || candidate.len > 4) return false;
  if (candidate.x < 0 || candidate.y < 0) return false;
  if (candidate.horiz && candidate.x + candidate.len > 10) return false;
  if (!candidate.horiz && candidate.y + candidate.len > 10) return false;
  if (candidate.x >= 10 || candidate.y >= 10) return false;

  var occupied = {};
  for (var i = 0; i < ships.length; i++) {
    if (i === ignoreIdx) continue;
    var s = ships[i];
    for (var k = 0; k < s.len; k++) {
      var sx = s.x + (s.horiz ? k : 0);
      var sy = s.y + (s.horiz ? 0 : k);
      for (var dx = -1; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
          var nx = sx + dx, ny = sy + dy;
          if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) occupied[ny * 10 + nx] = true;
        }
      }
    }
  }
  var cells = shipCells(candidate);
  for (var c = 0; c < cells.length; c++) {
    if (occupied[cells[c]]) return false;
  }
  return true;
}

function validateFleet(ships) {
  if (!Array.isArray(ships) || ships.length !== FLEET_LENS.length) return false;
  var lens = ships.map(function (s) { return s && s.len; }).slice().sort(function (a, b) { return b - a; });
  for (var i = 0; i < FLEET_LENS.length; i++) {
    if (lens[i] !== FLEET_LENS[i]) return false;
  }
  var placed = [];
  for (var j = 0; j < ships.length; j++) {
    if (!canPlaceShip(placed, ships[j], -1)) return false;
    placed.push(ships[j]);
  }
  return true;
}

function canonicalFleet(ships) {
  return ships.slice().sort(function (a, b) {
    if (b.len !== a.len) return b.len - a.len;
    var ca = a.y * 10 + a.x;
    var cb = b.y * 10 + b.x;
    return ca - cb;
  });
}

function packShipByte(ship) {
  return ((ship.y * 10 + ship.x) & 0x7f) | (ship.horiz ? 0x80 : 0);
}

function unpackShipByte(byteVal, len) {
  var cell = byteVal & 0x7f;
  if (cell >= 100) return null;
  return { x: cell % 10, y: Math.floor(cell / 10), len: len, horiz: (byteVal & 0x80) !== 0 };
}

function packFleet(ships) {
  if (!validateFleet(ships)) return null;
  var sorted = canonicalFleet(ships);
  var out = new Array(10);
  for (var i = 0; i < 10; i++) out[i] = packShipByte(sorted[i]);
  return out;
}

function unpackFleet(bytes10) {
  if (!bytes10 || bytes10.length !== 10) return null;
  var ships = [];
  for (var i = 0; i < 10; i++) {
    var s = unpackShipByte(bytes10[i], FLEET_LENS[i]);
    if (!s) return null;
    ships.push(s);
  }
  return validateFleet(ships) ? ships : null;
}

function randomFleet() {
  for (var attempt = 0; attempt < 200; attempt++) {
    var placed = [];
    var ok = true;
    for (var i = 0; i < FLEET_LENS.length; i++) {
      var len = FLEET_LENS[i];
      var candidates = [];
      for (var h = 0; h <= 1; h++) {
        var horiz = h === 1;
        var maxX = horiz ? 10 - len : 9;
        var maxY = horiz ? 9 : 10 - len;
        for (var y = 0; y <= maxY; y++) {
          for (var x = 0; x <= maxX; x++) {
            var cand = { x: x, y: y, len: len, horiz: horiz };
            if (canPlaceShip(placed, cand, -1)) candidates.push(cand);
          }
        }
      }
      if (candidates.length === 0) { ok = false; break; }
      placed.push(candidates[Math.floor(Math.random() * candidates.length)]);
    }
    if (ok) return canonicalFleet(placed);
  }
  return null;
}

/* Compact pure-JS SHA-256 (synchronous, works in iframe, Web Worker and Node vm). */
var SHA_K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];

function sha256Bytes(msg) {
  var len = msg.length;
  var bitLen = len * 8;
  var padLen = ((len + 9 + 63) >> 6) << 6;
  var buf = new Uint8Array(padLen);
  buf.set(msg);
  buf[len] = 0x80;
  buf[padLen - 4] = (bitLen >>> 24) & 0xff;
  buf[padLen - 3] = (bitLen >>> 16) & 0xff;
  buf[padLen - 2] = (bitLen >>> 8) & 0xff;
  buf[padLen - 1] = bitLen & 0xff;

  var H0 = 0x6a09e667, H1 = 0xbb67ae85, H2 = 0x3c6ef372, H3 = 0xa54ff53a;
  var H4 = 0x510e527f, H5 = 0x9b05688c, H6 = 0x1f83d9ab, H7 = 0x5be0cd19;
  var W = new Int32Array(64);

  for (var off = 0; off < padLen; off += 64) {
    for (var i = 0; i < 16; i++) {
      var o = off + i * 4;
      W[i] = (buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3];
    }
    for (var t = 16; t < 64; t++) {
      var w15 = W[t - 15], w2 = W[t - 2];
      var s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      var s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }
    var a = H0, b = H1, c = H2, d = H3, e = H4, f = H5, g = H6, h = H7;
    for (var r = 0; r < 64; r++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      var temp1 = (h + S1 + ch + SHA_K[r] + W[r]) | 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    H0 = (H0 + a) | 0; H1 = (H1 + b) | 0; H2 = (H2 + c) | 0; H3 = (H3 + d) | 0;
    H4 = (H4 + e) | 0; H5 = (H5 + f) | 0; H6 = (H6 + g) | 0; H7 = (H7 + h) | 0;
  }
  var out = new Uint8Array(32);
  var hs = [H0, H1, H2, H3, H4, H5, H6, H7];
  for (var j = 0; j < 8; j++) {
    out[j * 4] = (hs[j] >>> 24) & 0xff;
    out[j * 4 + 1] = (hs[j] >>> 16) & 0xff;
    out[j * 4 + 2] = (hs[j] >>> 8) & 0xff;
    out[j * 4 + 3] = hs[j] & 0xff;
  }
  return out;
}

function generateSalt8() {
  var out = new Array(8);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    var u = new Uint8Array(8);
    crypto.getRandomValues(u);
    for (var i = 0; i < 8; i++) out[i] = u[i];
  } else {
    for (var j = 0; j < 8; j++) out[j] = Math.floor(Math.random() * 256);
  }
  return out;
}

function computeCommit8(fleetBytes10, salt8) {
  var msg = new Uint8Array(18);
  for (var i = 0; i < 10; i++) msg[i] = fleetBytes10[i] & 0xff;
  for (var j = 0; j < 8; j++) msg[10 + j] = salt8[j] & 0xff;
  var digest = sha256Bytes(msg);
  return Array.from(digest.subarray(0, 8));
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if ((a[i] & 0xff) !== (b[i] & 0xff)) return false;
  return true;
}

/**
 * Evaluates an incoming shot at `cell` against `ships` given previously received enemy shots (`prevHitsSet`).
 * Returns `{ res, sunkShip, sunkLen }`.
 */
function evaluateShotAgainstFleet(ships, prevEnemyCells, cell) {
  var hitShip = null;
  for (var i = 0; i < ships.length; i++) {
    var cells = shipCells(ships[i]);
    if (cells.indexOf(cell) >= 0) { hitShip = ships[i]; break; }
  }
  if (!hitShip) return { res: RES_MISS, sunkShip: 0, sunkLen: 0 };

  var hitMap = {};
  for (var j = 0; j < prevEnemyCells.length; j++) hitMap[prevEnemyCells[j]] = true;
  hitMap[cell] = true;

  var shipSunk = shipCells(hitShip).every(function (c) { return !!hitMap[c]; });
  if (!shipSunk) return { res: RES_HIT, sunkShip: 0, sunkLen: 0 };

  var allSunk = ships.every(function (s) {
    return shipCells(s).every(function (c) { return !!hitMap[c]; });
  });
  return {
    res: allSunk ? RES_WIN : RES_SUNK,
    sunkShip: packShipByte(hitShip),
    sunkLen: hitShip.len
  };
}

/**
 * Derives full enemy & own board views, remaining ship counts, halo exclusions
 * around sunk ships, and whose turn it currently is directly from `g.log`.
 */
function deriveBoards(g) {
  var myRole = g.myRole || "a";
  var oppR = oppRole(myRole);
  var myShips = g.myFleetBytes ? unpackFleet(g.myFleetBytes) : null;
  var oppRevealed = g.oppFleetBytes ? unpackFleet(g.oppFleetBytes) : null;

  var myCells = new Array(100).fill(0); // 0=empty, 1=ship, 2=miss, 3=hit, 4=sunk
  var oppCells = new Array(100).fill(0); // 0=unknown, 1=revealedShip, 2=miss, 3=hit, 4=sunk, 5=halo
  var mySunkShips = [];
  var oppSunkShips = [];

  if (myShips) {
    for (var ms = 0; ms < myShips.length; ms++) {
      var sc = shipCells(myShips[ms]);
      for (var k = 0; k < sc.length; k++) myCells[sc[k]] = 1;
    }
  }
  if (oppRevealed) {
    for (var os = 0; os < oppRevealed.length; os++) {
      var osc = shipCells(oppRevealed[os]);
      for (var ok = 0; ok < osc.length; ok++) oppCells[osc[ok]] = 1;
    }
  }

  var log = Array.isArray(g.log) ? g.log : [];
  var turn = "a";
  var winnerFromLog = null;
  var myLastShot = -1;
  var oppLastShot = -1;

  for (var i = 0; i < log.length; i++) {
    var e = log[i];
    if (e.shooter === myRole) {
      myLastShot = e.cell;
      if (e.res === RES_MISS) {
        if (oppCells[e.cell] === 0 || oppCells[e.cell] === 5) oppCells[e.cell] = 2;
      } else {
        oppCells[e.cell] = 3;
      }
      if ((e.res === RES_SUNK || e.res === RES_WIN) && e.sunkLen > 0) {
        var sunk = unpackShipByte(e.sunkShip, e.sunkLen);
        if (sunk) {
          oppSunkShips.push(sunk);
          var sCells = shipCells(sunk);
          for (var a = 0; a < sCells.length; a++) {
            oppCells[sCells[a]] = 4;
            var sx = sCells[a] % 10, sy = Math.floor(sCells[a] / 10);
            for (var dx = -1; dx <= 1; dx++) {
              for (var dy = -1; dy <= 1; dy++) {
                var nx = sx + dx, ny = sy + dy;
                if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) {
                  var nIdx = ny * 10 + nx;
                  if (oppCells[nIdx] === 0) oppCells[nIdx] = 5;
                }
              }
            }
          }
        }
      }
    } else {
      oppLastShot = e.cell;
      if (e.res === RES_MISS) {
        myCells[e.cell] = 2;
      } else {
        myCells[e.cell] = 3;
      }
      if ((e.res === RES_SUNK || e.res === RES_WIN) && e.sunkLen > 0) {
        var mySunk = unpackShipByte(e.sunkShip, e.sunkLen);
        if (mySunk) {
          mySunkShips.push(mySunk);
          var msCells = shipCells(mySunk);
          for (var ma = 0; ma < msCells.length; ma++) myCells[msCells[ma]] = 4;
        }
      }
    }
    if (e.res === RES_WIN) {
      winnerFromLog = e.shooter;
      turn = e.shooter;
    } else if (e.res === RES_MISS) {
      turn = oppRole(e.shooter);
    } else {
      turn = e.shooter;
    }
  }

  function fleetStatusFromSunk(sunkList) {
    var rem = { 4: 1, 3: 2, 2: 3, 1: 4 };
    for (var s = 0; s < sunkList.length; s++) {
      var l = sunkList[s].len;
      if (rem[l] > 0) rem[l]--;
    }
    return { rem: rem, alive: rem[4] + rem[3] + rem[2] + rem[1] };
  }

  return {
    myShips: myShips,
    oppRevealed: oppRevealed,
    myCells: myCells,
    oppCells: oppCells,
    myFleetStatus: fleetStatusFromSunk(mySunkShips),
    oppFleetStatus: fleetStatusFromSunk(oppSunkShips),
    turn: turn,
    winnerFromLog: winnerFromLog,
    myLastShot: myLastShot,
    oppLastShot: oppLastShot,
    oppRole: oppR
  };
}

function verifyOpponentReveal(g) {
  if (!g.oppFleetBytes || !g.oppSalt) return null;
  var ships = unpackFleet(g.oppFleetBytes);
  if (!ships) return "mismatch";
  if (g.oppCommit && g.oppCommit.length === 8) {
    var expected = computeCommit8(g.oppFleetBytes, g.oppSalt);
    if (!sameBytes(expected, g.oppCommit)) return "mismatch";
  }
  var occupied = {};
  for (var i = 0; i < ships.length; i++) {
    var sc = shipCells(ships[i]);
    for (var j = 0; j < sc.length; j++) occupied[sc[j]] = true;
  }
  var log = Array.isArray(g.log) ? g.log : [];
  for (var k = 0; k < log.length; k++) {
    var e = log[k];
    if (e.shooter === g.myRole) {
      var hasShip = !!occupied[e.cell];
      var claimedHit = e.res !== RES_MISS;
      if (hasShip !== claimedHit) return "mismatch";
    }
  }
  return "ok";
}

function encodePacket(op, gameId, extra) {
  var out = new Uint8Array(3 + (extra ? extra.length : 0));
  out[0] = op & 0x1f;
  out[1] = gameId & 0xff;
  out[2] = (gameId >> 8) & 0xff;
  if (extra) out.set(extra, 3);
  return out;
}

function encodeInvite(gameId) {
  return encodePacket(OP_INVITE, gameId, [0]);
}

function encodeAccept(gameId) {
  return encodePacket(OP_ACCEPT, gameId, [0]);
}

function encodeDecline(gameId) {
  return encodePacket(OP_DECLINE, gameId, []);
}

function encodeReady(gameId, commit8) {
  var extra = new Uint8Array(8);
  for (var i = 0; i < 8; i++) extra[i] = (commit8 && commit8[i]) ? (commit8[i] & 0xff) : 0;
  return encodePacket(OP_READY, gameId, extra);
}

function encodeShot(gameId, seq, cell) {
  return encodePacket(OP_SHOT, gameId, [seq & 0xff, (seq >> 8) & 0xff, cell & 0xff]);
}

function encodeResult(gameId, seq, cell, res, sunkShip, sunkLen) {
  if (res === RES_SUNK || res === RES_WIN) {
    return encodePacket(OP_RESULT, gameId, [
      seq & 0xff, (seq >> 8) & 0xff, cell & 0xff, res & 0xff, (sunkShip || 0) & 0xff, (sunkLen || 0) & 0xff
    ]);
  }
  return encodePacket(OP_RESULT, gameId, [seq & 0xff, (seq >> 8) & 0xff, cell & 0xff, res & 0xff]);
}

function encodeActionPkt(gameId, seq, action) {
  return encodePacket(OP_ACTION, gameId, [seq & 0xff, (seq >> 8) & 0xff, action & 0xff]);
}

function encodeReveal(gameId, fleetBytes10, salt8) {
  var extra = new Uint8Array(18);
  for (var i = 0; i < 10; i++) extra[i] = fleetBytes10[i] & 0xff;
  for (var j = 0; j < 8; j++) extra[10 + j] = salt8[j] & 0xff;
  return encodePacket(OP_REVEAL, gameId, extra);
}

function gameSyncFlags(g) {
  var f = 0;
  if (g.myReady) f |= SYNC_FLAG_READY;
  if (g.oppReady) f |= SYNC_FLAG_OPP_READY;
  if (g.status === "finished") f |= SYNC_FLAG_FINISHED;
  if (g.myRole === "a" || g.myRole === "b") {
    f |= SYNC_FLAG_HAS_ROLE;
    if (g.myRole === "b") f |= SYNC_FLAG_IS_B;
  }
  return f;
}

function encodeSyncReq(gameId, knownSeq, flags, pendingSeq, pendingCell) {
  var pSeq = pendingSeq || 0;
  var pCell = typeof pendingCell === "number" ? pendingCell : 255;
  return encodePacket(OP_SYNC_REQ, gameId, [
    knownSeq & 0xff, (knownSeq >> 8) & 0xff, flags & 0xff,
    pSeq & 0xff, (pSeq >> 8) & 0xff, pCell & 0xff
  ]);
}

function encodeSyncLog(gameId, fromSeq, entries, myRole) {
  var count = Math.min(MAX_SYNC_LOG_ENTRIES, entries.length);
  var truncated = entries.length > count;
  var buf = new Uint8Array(3 + count * 3);
  buf[0] = fromSeq & 0xff;
  buf[1] = (fromSeq >> 8) & 0xff;
  buf[2] = count;
  for (var i = 0; i < count; i++) {
    var e = entries[i];
    buf[3 + i * 3] = e.cell & 0xff;
    buf[4 + i * 3] = (e.shooter === "b" ? 1 : 0) | ((e.res & 3) << 1) | (((e.sunkLen || 0) & 7) << 3);
    buf[5 + i * 3] = (e.sunkShip || 0) & 0xff;
  }
  var pkt = encodePacket(OP_SYNC_LOG, gameId, buf);
  if (myRole === "a" || myRole === "b") {
    pkt[0] |= HDR_HAS_ROLE | (myRole === "b" ? HDR_IS_B : 0);
  }
  if (truncated) pkt[0] |= HDR_MORE;
  return pkt;
}

function encodeUtf8Limited(text, maxBytes) {
  var enc = new TextEncoder();
  var bytes = enc.encode(String(text || "").trim());
  if (bytes.length <= maxBytes) return bytes;
  var cut = maxBytes;
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
  return bytes.slice(0, cut);
}

function encodeChatPkt(gameId, text) {
  return encodePacket(OP_CHAT, gameId, encodeUtf8Limited(text, MAX_CHAT_UTF8));
}

function decodePacket(bytes) {
  if (!bytes || bytes.length < 3) return null;
  var op = bytes[0] & 0x1f;
  var gameId = bytes[1] | (bytes[2] << 8);
  if (op === OP_INVITE) return { op: op, gameId: gameId };
  if (op === OP_ACCEPT) return { op: op, gameId: gameId };
  if (op === OP_DECLINE) return { op: op, gameId: gameId };
  if (op === OP_READY && bytes.length >= 11) {
    return { op: op, gameId: gameId, commit8: Array.from(bytes.subarray(3, 11)) };
  }
  if (op === OP_SHOT && bytes.length >= 6) {
    var scell = bytes[5];
    if (scell >= 100) return null;
    return { op: op, gameId: gameId, seq: bytes[3] | (bytes[4] << 8), cell: scell };
  }
  if (op === OP_RESULT && bytes.length >= 7) {
    var rcell = bytes[5];
    var rcode = bytes[6];
    if (rcell >= 100 || rcode > 3) return null;
    return {
      op: op,
      gameId: gameId,
      seq: bytes[3] | (bytes[4] << 8),
      cell: rcell,
      res: rcode,
      sunkShip: bytes.length >= 8 ? bytes[7] : 0,
      sunkLen: bytes.length >= 9 ? bytes[8] : 0
    };
  }
  if (op === OP_ACTION && bytes.length >= 6) {
    return { op: op, gameId: gameId, seq: bytes[3] | (bytes[4] << 8), action: bytes[5] };
  }
  if (op === OP_CHAT && bytes.length > 3) {
    var txt = new TextDecoder().decode(bytes.subarray(3)).trim();
    if (!txt) return null;
    return { op: op, gameId: gameId, text: txt };
  }
  if (op === OP_REVEAL && bytes.length >= 21) {
    return {
      op: op,
      gameId: gameId,
      fleetBytes: Array.from(bytes.subarray(3, 13)),
      salt8: Array.from(bytes.subarray(13, 21))
    };
  }
  if (op === OP_SYNC_REQ && bytes.length >= 6) {
    var flags = bytes[5];
    var senderRole = (flags & SYNC_FLAG_HAS_ROLE) ? ((flags & SYNC_FLAG_IS_B) ? "b" : "a") : null;
    return {
      op: op,
      gameId: gameId,
      knownSeq: bytes[3] | (bytes[4] << 8),
      flags: flags,
      senderRole: senderRole,
      pendingSeq: bytes.length >= 8 ? (bytes[6] | (bytes[7] << 8)) : 0,
      pendingCell: bytes.length >= 9 ? bytes[8] : 255
    };
  }
  if (op === OP_SYNC_LOG && bytes.length >= 6) {
    var fromSeq = bytes[3] | (bytes[4] << 8);
    var count = bytes[5];
    var entries = [];
    for (var i = 0; i < count && 6 + i * 3 + 2 < bytes.length; i++) {
      var c = bytes[6 + i * 3];
      var b1 = bytes[7 + i * 3];
      var b2 = bytes[8 + i * 3];
      if (c >= 100) break;
      entries.push({
        seq: fromSeq + i + 1,
        cell: c,
        shooter: (b1 & 1) ? "b" : "a",
        res: (b1 >> 1) & 3,
        sunkLen: (b1 >> 3) & 7,
        sunkShip: b2
      });
    }
    var logRole = (bytes[0] & HDR_HAS_ROLE) ? ((bytes[0] & HDR_IS_B) ? "b" : "a") : null;
    return { op: op, gameId: gameId, fromSeq: fromSeq, entries: entries, senderRole: logRole, hasMore: (bytes[0] & HDR_MORE) !== 0 };
  }
  return null;
}

function normalizeStoredGames(games) {
  var changed = false;
  if (!games || typeof games !== "object") return false;
  var keys = Object.keys(games);
  for (var i = 0; i < keys.length; i++) {
    var g = games[keys[i]];
    if (!g || typeof g !== "object") continue;
    if (!Array.isArray(g.log)) { g.log = []; changed = true; }
  }
  return changed;
}

function buildManualSyncPackets(g) {
  var pkts = [];
  if (g.status === "invited_out") {
    pkts.push(encodeInvite(g.gameId));
    if (g.myReady && g.myCommit) pkts.push(encodeReady(g.gameId, g.myCommit));
    return pkts;
  }
  if (g.status === "setup") {
    if (g.myRole === "b") pkts.push(encodeAccept(g.gameId));
    if (g.myReady && g.myCommit) pkts.push(encodeReady(g.gameId, g.myCommit));
  }
  if (g.status === "playing" && g.pendingShot) {
    pkts.push(encodeShot(g.gameId, g.pendingShot.seq, g.pendingShot.cell));
  }
  if (g.status === "finished") {
    if (g.finishAction) pkts.push(encodeActionPkt(g.gameId, g.log.length, g.finishAction));
    if (g.myFleetBytes && g.mySalt) pkts.push(encodeReveal(g.gameId, g.myFleetBytes, g.mySalt));
  }
  pkts.push(encodeSyncReq(
    g.gameId,
    g.log.length,
    gameSyncFlags(g),
    g.pendingShot ? g.pendingShot.seq : 0,
    g.pendingShot ? g.pendingShot.cell : 255
  ));
  return pkts;
}

function formatShotSummary(entry, locale) {
  var ru = locale === "ru";
  var coord = cellName(entry.cell, locale);
  if (entry.res === RES_MISS) return coord + " — " + (ru ? "мимо" : "miss");
  if (entry.res === RES_HIT) return coord + " — " + (ru ? "ранил!" : "hit!");
  if (entry.res === RES_SUNK) return coord + " — " + (ru ? "потопил!" : "sunk!");
  return coord + " — " + (ru ? "победа!" : "victory!");
}

function buildActivities(games, locale) {
  var ru = locale === "ru";
  return Object.values(games)
    .filter(function (g) { return g.status !== "declined"; })
    .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })
    .map(function (g) {
      var st = deriveBoards(g);
      var last = g.log && g.log.length ? g.log[g.log.length - 1] : null;
      var badge = null;
      var subtitle = "";
      var attention = false;
      if (g.status === "invited_in") {
        badge = { text: ru ? "Вызов" : "Invite", tone: "accent" };
        subtitle = ru ? "Приглашение в Морской бой" : "Battleship invitation";
        attention = true;
      } else if (g.status === "invited_out") {
        badge = { text: ru ? "Ожидание" : "Pending", tone: "neutral" };
        subtitle = g.myReady
          ? (ru ? "Флот готов • ждём ответа" : "Fleet ready • waiting")
          : (ru ? "Расставьте флот, пока ждёте" : "Place fleet while waiting");
      } else if (g.status === "setup") {
        if (!g.myReady) {
          badge = { text: ru ? "Флот" : "Setup", tone: "accent" };
          subtitle = g.oppReady
            ? (ru ? "Соперник готов — расставьте корабли" : "Opponent ready — place ships")
            : (ru ? "Расставьте корабли" : "Place your fleet");
          attention = true;
        } else {
          badge = { text: ru ? "Ожидание" : "Waiting", tone: "neutral" };
          subtitle = ru ? "Вы готовы — ждём флот соперника" : "Ready — waiting for opponent";
        }
      } else if (g.status === "finished") {
        var win = g.winner === g.myRole;
        badge = { text: win ? (ru ? "Победа" : "Won") : (ru ? "Поражение" : "Lost"), tone: win ? "success" : "danger" };
        subtitle = last ? formatShotSummary(last, locale) : (ru ? "Партия завершена" : "Game over");
      } else {
        var myTurn = st.turn === g.myRole && !g.pendingShot;
        if (myTurn) {
          badge = { text: ru ? "Ваш залп" : "Your shot", tone: "success" };
          subtitle = last ? formatShotSummary(last, locale) : (ru ? "Бой начался!" : "Battle started!");
          attention = true;
        } else if (g.pendingShot) {
          badge = { text: ru ? "Залп…" : "Firing…", tone: "neutral" };
          subtitle = (ru ? "Ждём ответ по " : "Awaiting result for ") + cellName(g.pendingShot.cell, locale);
        } else {
          badge = { text: ru ? "Ход врага" : "Waiting", tone: "neutral" };
          subtitle = last ? formatShotSummary(last, locale) : (ru ? "Ждём выстрел соперника" : "Waiting for enemy shot");
        }
      }
      if ((g.unreadChat || 0) > 0) attention = true;
      return {
        id: g.id,
        peerKeyPrefix: g.peerPrefix,
        title: g.peerName || g.peerPrefix.slice(0, 8),
        subtitle: subtitle,
        badge: badge,
        needsAttention: attention,
        updatedAt: g.updatedAt || Date.now()
      };
    });
}

function resolveIncomingShot(g, seq, cell, mirrored, locale, pushReply) {
  var ru = locale === "ru";
  var shooter = mirrored ? g.myRole : oppRole(g.myRole);
  // Idempotent replay: if we already answered this seq, re-send the exact recorded result.
  if (seq > 0 && seq <= g.log.length) {
    var existing = g.log[seq - 1];
    if (existing && existing.shooter === shooter && existing.cell === cell && !mirrored) {
      pushReply(encodeResult(g.gameId, seq, cell, existing.res, existing.sunkShip, existing.sunkLen));
      if (existing.res === RES_WIN && g.myFleetBytes && g.mySalt) {
        pushReply(encodeReveal(g.gameId, g.myFleetBytes, g.mySalt));
      }
    }
    return { changed: false, notify: null };
  }
  if (seq !== g.log.length + 1) {
    pushReply(encodeSyncReq(g.gameId, g.log.length, gameSyncFlags(g), g.pendingShot ? g.pendingShot.seq : 0, g.pendingShot ? g.pendingShot.cell : 255));
    return { changed: false, notify: null };
  }
  if (mirrored) {
    g.pendingShot = { seq: seq, cell: cell };
    g.updatedAt = Date.now();
    return { changed: true, notify: null };
  }
  var myShips = g.myFleetBytes ? unpackFleet(g.myFleetBytes) : null;
  if (!myShips) return { changed: false, notify: null };

  if (g.status === "setup" || g.status === "invited_out") {
    g.oppReady = true;
    g.status = "playing";
  }

  var prevEnemyCells = [];
  for (var i = 0; i < g.log.length; i++) {
    if (g.log[i].shooter !== g.myRole) prevEnemyCells.push(g.log[i].cell);
  }
  var ev = evaluateShotAgainstFleet(myShips, prevEnemyCells, cell);
  var entry = { seq: seq, shooter: shooter, cell: cell, res: ev.res, sunkShip: ev.sunkShip, sunkLen: ev.sunkLen };
  g.log.push(entry);
  g.pendingShot = null;
  g.updatedAt = Date.now();

  pushReply(encodeResult(g.gameId, seq, cell, ev.res, ev.sunkShip, ev.sunkLen));

  var notify = null;
  var coord = cellName(cell, locale);
  if (ev.res === RES_WIN) {
    g.status = "finished";
    g.winner = shooter;
    g.finishAction = null;
    if (g.myFleetBytes && g.mySalt) pushReply(encodeReveal(g.gameId, g.myFleetBytes, g.mySalt));
    notify = { body: (ru ? "Ваш флот потоплен (" + coord + ") — поражение" : "Your fleet was sunk (" + coord + ") — you lost"), tag: "game:" + g.id, peerPrefix: g.peerPrefix };
  } else if (ev.res === RES_MISS) {
    notify = { body: (ru ? "Мимо (" + coord + ") — ваш выстрел!" : "Miss (" + coord + ") — your turn!"), tag: "game:" + g.id, peerPrefix: g.peerPrefix };
  }
  return { changed: true, notify: notify };
}

function applyIncomingPacket(games, packet, locale) {
  var ru = locale === "ru";
  var decoded = decodePacket(packet.payload);
  if (!decoded) return { changed: false, notify: null, replies: [] };
  var gid = decoded.gameId;
  var key = "g:" + gid.toString(16).padStart(4, "0");
  var g = games[key];
  var now = Date.now();
  var replies = [];
  var notify = null;
  var mirrored = Boolean(packet.mirrored);
  var peerName = packet.peerName || packet.peerPrefix.slice(0, 8);

  function pushReply(payloadBytes) {
    if (mirrored) return;
    replies.push({ peerPrefix: packet.peerPrefix, payload: Array.from(payloadBytes), retry: true });
  }

  if (decoded.op === OP_INVITE) {
    if (!g) {
      games[key] = {
        id: key,
        gameId: gid,
        peerPrefix: packet.peerPrefix,
        peerName: peerName,
        myRole: mirrored ? "a" : "b",
        status: mirrored ? "invited_out" : "invited_in",
        myReady: false,
        oppReady: false,
        myFleetBytes: null,
        mySalt: null,
        myCommit: null,
        oppCommit: null,
        oppFleetBytes: null,
        oppSalt: null,
        revealVerified: null,
        log: [],
        pendingShot: null,
        winner: null,
        finishAction: null,
        updatedAt: now
      };
      if (!mirrored) notify = { body: ru ? "Приглашение в Морской бой" : "Battleship invitation", tag: "game:" + key, peerPrefix: packet.peerPrefix };
      return { changed: true, notify: notify, replies: replies, gameKey: key };
    }
    if (!mirrored && g.status !== "invited_in" && g.status !== "declined") {
      pushReply(encodeAccept(gid));
      if (g.myReady && g.myCommit) pushReply(encodeReady(gid, g.myCommit));
    }
    return { changed: false, notify: null, replies: replies, gameKey: key };
  }

  if (!g) {
    var canCreate = decoded.op === OP_ACCEPT || decoded.op === OP_READY || decoded.op === OP_SYNC_LOG ||
      (decoded.op === OP_SYNC_REQ && Boolean(decoded.senderRole));
    if (!canCreate) return { changed: false, notify: null, replies: [] };
    var inferredRole = "b";
    if (decoded.op === OP_ACCEPT) inferredRole = mirrored ? "b" : "a";
    else if (decoded.senderRole) inferredRole = mirrored ? decoded.senderRole : oppRole(decoded.senderRole);
    g = {
      id: key, gameId: gid, peerPrefix: packet.peerPrefix, peerName: peerName,
      myRole: inferredRole, status: "setup",
      myReady: false, oppReady: false,
      myFleetBytes: null, mySalt: null, myCommit: null,
      oppCommit: null, oppFleetBytes: null, oppSalt: null, revealVerified: null,
      log: [], pendingShot: null, winner: null, finishAction: null, updatedAt: now
    };
    games[key] = g;
  }
  if (peerName && !mirrored) g.peerName = peerName;

  if (decoded.op === OP_ACCEPT) {
    if (g.status === "invited_out" || g.status === "invited_in") {
      g.status = (g.myReady && g.oppReady) ? "playing" : "setup";
      g.updatedAt = now;
      if (!mirrored && g.myReady && g.myCommit) {
        pushReply(encodeReady(gid, g.myCommit));
      }
      if (!mirrored) notify = { body: ru ? "Приглашение принято — расставьте флот" : "Invite accepted — place your fleet", tag: "game:" + key, peerPrefix: packet.peerPrefix };
      return { changed: true, notify: notify, replies: replies, gameKey: key, synced: true };
    }
    return { changed: false, notify: null, replies: replies, gameKey: key, synced: true };
  }

  if (decoded.op === OP_DECLINE) {
    g.status = "declined";
    g.updatedAt = now;
    if (!mirrored) notify = { body: ru ? "Приглашение отклонено" : "Invite declined", tag: "game:" + key, peerPrefix: packet.peerPrefix };
    return { changed: true, notify: notify, replies: [], gameKey: key };
  }

  if (decoded.op === OP_READY) {
    var changedR = false;
    if (mirrored) {
      if (!g.myReady) { g.myReady = true; g.myCommit = decoded.commit8; changedR = true; }
    } else {
      if (!g.oppReady || !sameBytes(g.oppCommit, decoded.commit8)) {
        g.oppReady = true;
        g.oppCommit = decoded.commit8;
        changedR = true;
      }
    }
    if (g.status === "invited_out" || g.status === "invited_in") {
      g.status = "setup";
      changedR = true;
    }
    if (g.status === "setup" && g.myReady && g.oppReady) {
      g.status = "playing";
      changedR = true;
    }
    if (changedR) g.updatedAt = now;
    if (!mirrored && g.status === "setup" && g.myReady && g.myCommit) {
      pushReply(encodeReady(gid, g.myCommit));
    }
    if (!mirrored && changedR) {
      if (g.status === "playing") {
        notify = {
          body: g.myRole === "a"
            ? (ru ? "Соперник готов — ваш первый залп!" : "Opponent ready — fire first!")
            : (ru ? "Бой начался — ждём первый залп соперника" : "Battle started — opponent fires first"),
          tag: "game:" + key,
          peerPrefix: packet.peerPrefix
        };
      } else {
        notify = { body: ru ? "Соперник расставил флот — ваш черёд" : "Opponent placed their fleet", tag: "game:" + key, peerPrefix: packet.peerPrefix };
      }
    }
    return { changed: changedR, notify: notify, replies: replies, gameKey: key, synced: true };
  }

  if (decoded.op === OP_SHOT) {
    var shotRes = resolveIncomingShot(g, decoded.seq, decoded.cell, mirrored, locale, pushReply);
    return { changed: shotRes.changed, notify: shotRes.notify, replies: replies, gameKey: key };
  }

  if (decoded.op === OP_RESULT) {
    var shooter = mirrored ? oppRole(g.myRole) : g.myRole;
    if (decoded.seq <= g.log.length) {
      if (g.pendingShot && g.pendingShot.seq <= g.log.length) {
        g.pendingShot = null;
        return { changed: true, notify: null, replies: [], gameKey: key, synced: true };
      }
      return { changed: false, notify: null, replies: [], gameKey: key, synced: true };
    }
    if (decoded.seq > g.log.length + 1) {
      pushReply(encodeSyncReq(gid, g.log.length, gameSyncFlags(g), g.pendingShot ? g.pendingShot.seq : 0, g.pendingShot ? g.pendingShot.cell : 255));
      return { changed: false, notify: null, replies: replies, gameKey: key };
    }
    var entry = {
      seq: decoded.seq,
      shooter: shooter,
      cell: decoded.cell,
      res: decoded.res,
      sunkShip: decoded.sunkShip || 0,
      sunkLen: decoded.sunkLen || 0
    };
    g.log.push(entry);
    if (g.pendingShot && g.pendingShot.seq === decoded.seq) g.pendingShot = null;
    g.updatedAt = now;
    var coord = cellName(decoded.cell, locale);

    if (decoded.res === RES_WIN) {
      g.status = "finished";
      g.winner = shooter;
      g.finishAction = null;
      if (!mirrored && g.myFleetBytes && g.mySalt) {
        pushReply(encodeReveal(gid, g.myFleetBytes, g.mySalt));
      }
      if (!mirrored) {
        notify = { body: (ru ? "Победа! Весь флот потоплен (" + coord + ")" : "Victory! Enemy fleet sunk (" + coord + ")"), tag: "game:" + key, peerPrefix: packet.peerPrefix };
      }
    } else if (!mirrored) {
      if (decoded.res === RES_SUNK) {
        notify = { body: (ru ? "Потопил (" + coord + ")! Стреляйте снова" : "Ship sunk (" + coord + ")! Fire again"), tag: "game:" + key, peerPrefix: packet.peerPrefix };
      } else if (decoded.res === RES_HIT) {
        notify = { body: (ru ? "Попадание (" + coord + ")! Стреляйте снова" : "Hit (" + coord + ")! Fire again"), tag: "game:" + key, peerPrefix: packet.peerPrefix };
      }
    }
    return { changed: true, notify: notify, replies: replies, gameKey: key, synced: true };
  }

  if (decoded.op === OP_ACTION) {
    if (decoded.action === ACT_RESIGN) {
      var nextWin = mirrored ? oppRole(g.myRole) : g.myRole;
      if (g.status === "finished" && g.winner === nextWin) return { changed: false, notify: null, replies: [], gameKey: key, synced: true };
      g.status = "finished";
      g.winner = nextWin;
      g.finishAction = mirrored ? ACT_RESIGN : null;
      g.pendingShot = null;
      g.updatedAt = now;
      if (!mirrored && g.myFleetBytes && g.mySalt) {
        pushReply(encodeReveal(gid, g.myFleetBytes, g.mySalt));
      }
      if (!mirrored) notify = { body: ru ? "Соперник сдался — вы победили!" : "Opponent resigned — you win!", tag: "game:" + key, peerPrefix: packet.peerPrefix };
      return { changed: true, notify: notify, replies: replies, gameKey: key, synced: true };
    }
  }

  if (decoded.op === OP_REVEAL) {
    if (mirrored) {
      g.myFleetBytes = decoded.fleetBytes;
      g.mySalt = decoded.salt8;
      return { changed: true, notify: null, replies: [], gameKey: key };
    }
    g.oppFleetBytes = decoded.fleetBytes;
    g.oppSalt = decoded.salt8;
    g.revealVerified = verifyOpponentReveal(g);
    g.updatedAt = now;
    return { changed: true, notify: null, replies: [], gameKey: key, synced: true };
  }

  if (decoded.op === OP_SYNC_REQ) {
    var changedReq = false;
    if ((decoded.flags & SYNC_FLAG_READY) && !mirrored && !g.oppReady) {
      g.oppReady = true;
      changedReq = true;
    }
    if (g.status === "invited_out" && (decoded.knownSeq > 0 || (decoded.flags & (SYNC_FLAG_READY | SYNC_FLAG_FINISHED)))) {
      g.status = (g.myReady && g.oppReady) ? "playing" : "setup";
      changedReq = true;
    }
    if (g.status === "setup" && g.myReady && g.oppReady) {
      g.status = "playing";
      changedReq = true;
    }
    if (!mirrored) {
      if (g.myReady && g.myCommit && !(decoded.flags & SYNC_FLAG_OPP_READY) && g.log.length === 0) {
        pushReply(encodeReady(gid, g.myCommit));
      }
      if (decoded.pendingSeq > 0 && decoded.pendingCell < 100) {
        var rShot = resolveIncomingShot(g, decoded.pendingSeq, decoded.pendingCell, false, locale, pushReply);
        if (rShot.changed) changedReq = true;
        if (rShot.notify) notify = rShot.notify;
      }
      if (decoded.knownSeq < g.log.length) {
        var slice = g.log.slice(decoded.knownSeq);
        pushReply(encodeSyncLog(gid, decoded.knownSeq, slice, g.myRole));
      } else if (decoded.knownSeq > g.log.length) {
        pushReply(encodeSyncReq(gid, g.log.length, gameSyncFlags(g), g.pendingShot ? g.pendingShot.seq : 0, g.pendingShot ? g.pendingShot.cell : 255));
      } else {
        if (g.status === "finished" && g.finishAction) pushReply(encodeActionPkt(gid, g.log.length, g.finishAction));
        if (g.status === "finished" && g.myFleetBytes && g.mySalt) pushReply(encodeReveal(gid, g.myFleetBytes, g.mySalt));
        if (replies.length === 0) pushReply(encodeSyncLog(gid, g.log.length, [], g.myRole));
      }
    }
    if (changedReq) g.updatedAt = now;
    return { changed: changedReq, notify: notify, replies: replies, gameKey: key };
  }

  if (decoded.op === OP_SYNC_LOG) {
    if (decoded.fromSeq > g.log.length) {
      pushReply(encodeSyncReq(gid, g.log.length, gameSyncFlags(g), g.pendingShot ? g.pendingShot.seq : 0, g.pendingShot ? g.pendingShot.cell : 255));
      return { changed: false, notify: null, replies: replies, gameKey: key };
    }
    if (decoded.entries.length === 0) {
      return { changed: false, notify: null, replies: [], gameKey: key, synced: true };
    }
    var changedLog = false;
    for (var li = 0; li < decoded.entries.length; li++) {
      var ent = decoded.entries[li];
      if (ent.seq === g.log.length + 1) {
        g.log.push(ent);
        changedLog = true;
      }
    }
    if (changedLog) {
      if (g.pendingShot && g.pendingShot.seq <= g.log.length) g.pendingShot = null;
      var stAfter = deriveBoards(g);
      if (stAfter.winnerFromLog) {
        g.status = "finished";
        g.winner = stAfter.winnerFromLog;
      } else if (g.status === "setup" || g.status === "invited_out") {
        g.oppReady = true;
        g.status = "playing";
      }
      g.updatedAt = now;
      if (decoded.hasMore) {
        pushReply(encodeSyncReq(gid, g.log.length, gameSyncFlags(g), 0, 255));
      }
    }
    return { changed: changedLog, notify: null, replies: replies, gameKey: key, synced: true };
  }

  if (decoded.op === OP_CHAT) {
    if (!Array.isArray(g.chat)) g.chat = [];
    var fromSide = mirrored ? "me" : "opp";
    var ts = packet.timestamp || Math.floor(now / 1000);
    var dup = g.chat.some(function (m) {
      return m.from === fromSide && m.text === decoded.text && Math.abs((m.ts || 0) - ts) <= 5;
    });
    if (dup) return { changed: false, notify: null, replies: [] };
    g.chat.push({
      id: "m:" + ts + ":" + Math.random().toString(36).slice(2, 7),
      from: fromSide,
      text: decoded.text,
      at: now,
      ts: ts,
      status: "delivered"
    });
    if (g.chat.length > 80) g.chat = g.chat.slice(-80);
    g.updatedAt = now;
    if (!mirrored) {
      g.unreadChat = (g.unreadChat || 0) + 1;
      notify = { body: decoded.text, tag: "game:" + key, peerPrefix: packet.peerPrefix };
    }
    return { changed: true, notify: notify, replies: [], gameKey: key, isChat: true };
  }

  return { changed: false, notify: null, replies: replies };
}
