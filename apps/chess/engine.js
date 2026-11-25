var OP_INVITE = 1, OP_ACCEPT = 2, OP_DECLINE = 3, OP_MOVE = 4, OP_ACTION = 5, OP_SYNC_REQ = 6, OP_SYNC_MOVES = 7, OP_CHAT = 8;
var MAX_CHAT_UTF8 = 147;
var MAX_SYNC_CHUNK = 72;
var ACT_RESIGN = 1, ACT_DRAW_OFFER = 2, ACT_DRAW_ACCEPT = 3, ACT_DRAW_DECLINE = 4;
var SYNC_FLAG_ACTIVE = 1, SYNC_FLAG_FINISHED = 2, SYNC_FLAG_WIN_W = 4, SYNC_FLAG_WIN_B = 8, SYNC_FLAG_DRAW = 16;
var SYNC_FLAG_HAS_COLOR = 32, SYNC_FLAG_SENDER_B = 64;
var HDR_HAS_COLOR = 0x20, HDR_SENDER_B = 0x40;
var PROMO_MAP = ["", "n", "b", "r", "q"];

function sqName(sq) {
  return "abcdefgh"[sq & 7] + String((sq >> 3) + 1);
}

function packMove(from, to, promoIdx, offerDraw) {
  return (from & 63) | ((to & 63) << 6) | ((promoIdx & 7) << 12) | (offerDraw ? 0x8000 : 0);
}

function unpackMove(bits) {
  return {
    from: bits & 63,
    to: (bits >> 6) & 63,
    promo: (bits >> 12) & 7,
    offerDraw: (bits & 0x8000) !== 0
  };
}

function initialState() {
  var b = new Array(64).fill("");
  var back = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (var f = 0; f < 8; f++) {
    b[f] = back[f].toUpperCase();
    b[8 + f] = "P";
    b[48 + f] = "p";
    b[56 + f] = back[f];
  }
  return { board: b, turn: "w", castle: 15, ep: -1, half: 0, ply: 0 };
}

function clonePos(p) {
  return { board: p.board.slice(), turn: p.turn, castle: p.castle, ep: p.ep, half: p.half, ply: p.ply };
}

function pieceColor(ch) {
  if (!ch) return "";
  return ch === ch.toUpperCase() ? "w" : "b";
}

function posHash8(p) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < 64; i++) {
    var c = p.board[i] ? p.board[i].charCodeAt(0) : 46;
    h = Math.imul(h ^ c, 16777619) >>> 0;
  }
  h = Math.imul(h ^ (p.turn === "w" ? 1 : 2), 16777619) >>> 0;
  h = Math.imul(h ^ p.castle, 16777619) >>> 0;
  h = Math.imul(h ^ (p.ep + 2), 16777619) >>> 0;
  return h & 0xff;
}

function isAttacked(board, sq, byColor) {
  var f = sq & 7, r = sq >> 3;
  var pawnDir = byColor === "w" ? -1 : 1;
  var pr = r + pawnDir;
  var enemyP = byColor === "w" ? "P" : "p";
  if (pr >= 0 && pr < 8) {
    if (f > 0 && board[(pr << 3) | (f - 1)] === enemyP) return true;
    if (f < 7 && board[(pr << 3) | (f + 1)] === enemyP) return true;
  }
  var enemyN = byColor === "w" ? "N" : "n";
  var kd = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  for (var i = 0; i < kd.length; i++) {
    var nf = f + kd[i][0], nr = r + kd[i][1];
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && board[(nr << 3) | nf] === enemyN) return true;
  }
  var enemyK = byColor === "w" ? "K" : "k";
  for (var df = -1; df <= 1; df++) {
    for (var dr = -1; dr <= 1; dr++) {
      if (!df && !dr) continue;
      var kf = f + df, kr = r + dr;
      if (kf >= 0 && kf < 8 && kr >= 0 && kr < 8 && board[(kr << 3) | kf] === enemyK) return true;
    }
  }
  var enemyB = byColor === "w" ? "B" : "b";
  var enemyR = byColor === "w" ? "R" : "r";
  var enemyQ = byColor === "w" ? "Q" : "q";
  var diag = [[-1,-1],[-1,1],[1,-1],[1,1]];
  for (var d = 0; d < 4; d++) {
    var cf = f + diag[d][0], cr = r + diag[d][1];
    while (cf >= 0 && cf < 8 && cr >= 0 && cr < 8) {
      var pc = board[(cr << 3) | cf];
      if (pc) { if (pc === enemyB || pc === enemyQ) return true; break; }
      cf += diag[d][0]; cr += diag[d][1];
    }
  }
  var ortho = [[-1,0],[1,0],[0,-1],[0,1]];
  for (var o = 0; o < 4; o++) {
    var of = f + ortho[o][0], or = r + ortho[o][1];
    while (of >= 0 && of < 8 && or >= 0 && or < 8) {
      var pc2 = board[(or << 3) | of];
      if (pc2) { if (pc2 === enemyR || pc2 === enemyQ) return true; break; }
      of += ortho[o][0]; or += ortho[o][1];
    }
  }
  return false;
}

function kingSquare(board, color) {
  var k = color === "w" ? "K" : "k";
  for (var i = 0; i < 64; i++) if (board[i] === k) return i;
  return -1;
}

function inCheck(p, color) {
  var ks = kingSquare(p.board, color);
  return ks >= 0 && isAttacked(p.board, ks, color === "w" ? "b" : "w");
}

function applyMoveUnchecked(p, from, to, promoIdx) {
  var next = clonePos(p);
  var b = next.board;
  var pc = b[from];
  var type = pc.toLowerCase();
  var color = pieceColor(pc);
  var captured = b[to];
  b[to] = pc;
  b[from] = "";
  next.ep = -1;
  if (type === "p") {
    next.half = 0;
    if (to === p.ep) {
      var capSq = color === "w" ? to - 8 : to + 8;
      b[capSq] = "";
      captured = color === "w" ? "p" : "P";
    }
    if (Math.abs((to >> 3) - (from >> 3)) === 2) {
      next.ep = (from + to) >> 1;
    }
    var rank = to >> 3;
    if (rank === 0 || rank === 7) {
      var pr = PROMO_MAP[promoIdx || 4] || "q";
      b[to] = color === "w" ? pr.toUpperCase() : pr;
    }
  } else {
    next.half = captured ? 0 : p.half + 1;
  }
  if (type === "k") {
    if (color === "w") next.castle &= ~3; else next.castle &= ~12;
    if (to - from === 2) { b[to - 1] = b[to + 1]; b[to + 1] = ""; }
    else if (from - to === 2) { b[to + 1] = b[to - 2]; b[to - 2] = ""; }
  }
  if (from === 0 || to === 0) next.castle &= ~2;
  if (from === 7 || to === 7) next.castle &= ~1;
  if (from === 56 || to === 56) next.castle &= ~8;
  if (from === 63 || to === 63) next.castle &= ~4;
  next.turn = color === "w" ? "b" : "w";
  next.ply = p.ply + 1;
  return { pos: next, captured: captured };
}

function legalMoves(p) {
  var moves = [];
  var color = p.turn;
  var enemy = color === "w" ? "b" : "w";
  var b = p.board;
  function tryPush(from, to, promo) {
    var res = applyMoveUnchecked(p, from, to, promo);
    if (!inCheck(res.pos, color)) moves.push({ from: from, to: to, promo: promo || 0 });
  }
  for (var sq = 0; sq < 64; sq++) {
    var pc = b[sq];
    if (!pc || pieceColor(pc) !== color) continue;
    var type = pc.toLowerCase();
    var f = sq & 7, r = sq >> 3;
    if (type === "p") {
      var dir = color === "w" ? 1 : -1;
      var startR = color === "w" ? 1 : 6;
      var promoR = color === "w" ? 7 : 0;
      var r1 = r + dir;
      if (r1 >= 0 && r1 < 8) {
        var fwd = (r1 << 3) | f;
        if (!b[fwd]) {
          if (r1 === promoR) { for (var pr = 1; pr <= 4; pr++) tryPush(sq, fwd, pr); }
          else {
            tryPush(sq, fwd, 0);
            if (r === startR) {
              var fwd2 = ((r + 2 * dir) << 3) | f;
              if (!b[fwd2]) tryPush(sq, fwd2, 0);
            }
          }
        }
        var caps = [-1, 1];
        for (var ci = 0; ci < 2; ci++) {
          var cf = f + caps[ci];
          if (cf < 0 || cf > 7) continue;
          var tsq = (r1 << 3) | cf;
          if ((b[tsq] && pieceColor(b[tsq]) === enemy) || tsq === p.ep) {
            if (r1 === promoR) { for (var pr2 = 1; pr2 <= 4; pr2++) tryPush(sq, tsq, pr2); }
            else tryPush(sq, tsq, 0);
          }
        }
      }
    } else if (type === "n") {
      var nd = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      for (var ni = 0; ni < 8; ni++) {
        var nf = f + nd[ni][0], nr = r + nd[ni][1];
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        var nsq = (nr << 3) | nf;
        if (!b[nsq] || pieceColor(b[nsq]) === enemy) tryPush(sq, nsq, 0);
      }
    } else if (type === "k") {
      for (var df = -1; df <= 1; df++) {
        for (var dr = -1; dr <= 1; dr++) {
          if (!df && !dr) continue;
          var kf = f + df, kr = r + dr;
          if (kf < 0 || kf > 7 || kr < 0 || kr > 7) continue;
          var ksq = (kr << 3) | kf;
          if (!b[ksq] || pieceColor(b[ksq]) === enemy) tryPush(sq, ksq, 0);
        }
      }
      if (!inCheck(p, color)) {
        if (color === "w" && sq === 4) {
          if ((p.castle & 1) && !b[5] && !b[6] && b[7] === "R" && !isAttacked(b, 5, "b") && !isAttacked(b, 6, "b")) tryPush(4, 6, 0);
          if ((p.castle & 2) && !b[3] && !b[2] && !b[1] && b[0] === "R" && !isAttacked(b, 3, "b") && !isAttacked(b, 2, "b")) tryPush(4, 2, 0);
        } else if (color === "b" && sq === 60) {
          if ((p.castle & 4) && !b[61] && !b[62] && b[63] === "r" && !isAttacked(b, 61, "w") && !isAttacked(b, 62, "w")) tryPush(60, 62, 0);
          if ((p.castle & 8) && !b[59] && !b[58] && !b[57] && b[56] === "r" && !isAttacked(b, 59, "w") && !isAttacked(b, 58, "w")) tryPush(60, 58, 0);
        }
      }
    } else {
      var dirs = type === "b" ? [[-1,-1],[-1,1],[1,-1],[1,1]]
               : type === "r" ? [[-1,0],[1,0],[0,-1],[0,1]]
               : [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]];
      for (var di = 0; di < dirs.length; di++) {
        var sf = f + dirs[di][0], sr = r + dirs[di][1];
        while (sf >= 0 && sf < 8 && sr >= 0 && sr < 8) {
          var ssq = (sr << 3) | sf;
          if (!b[ssq]) { tryPush(sq, ssq, 0); }
          else { if (pieceColor(b[ssq]) === enemy) tryPush(sq, ssq, 0); break; }
          sf += dirs[di][0]; sr += dirs[di][1];
        }
      }
    }
  }
  return moves;
}

function formatMoveLabel(p, move, nextPos) {
  var pc = p.board[move.from];
  var type = pc.toLowerCase();
  var cap = !!p.board[move.to] || (type === "p" && move.to === p.ep);
  var s = "";
  if (type === "k" && move.to - move.from === 2) s = "O-O";
  else if (type === "k" && move.from - move.to === 2) s = "O-O-O";
  else {
    if (type !== "p") s += type.toUpperCase();
    else if (cap) s += "abcdefgh"[move.from & 7];
    if (cap) s += "x";
    s += sqName(move.to);
    if (move.promo) s += "=" + PROMO_MAP[move.promo].toUpperCase();
  }
  var nextLegal = legalMoves(nextPos);
  var chk = inCheck(nextPos, nextPos.turn);
  if (chk && nextLegal.length === 0) s += "#";
  else if (chk) s += "+";
  return s;
}

function replayMoves(moveBitsList) {
  var pos = initialState();
  var labels = [];
  for (var i = 0; i < moveBitsList.length; i++) {
    var u = unpackMove(moveBitsList[i]);
    var legal = legalMoves(pos);
    var match = null;
    for (var j = 0; j < legal.length; j++) {
      if (legal[j].from === u.from && legal[j].to === u.to && legal[j].promo === u.promo) { match = legal[j]; break; }
    }
    if (!match) return null;
    var res = applyMoveUnchecked(pos, match.from, match.to, match.promo);
    labels.push(formatMoveLabel(pos, match, res.pos));
    pos = res.pos;
  }
  var legalEnd = legalMoves(pos);
  var check = inCheck(pos, pos.turn);
  var outcome = null;
  if (legalEnd.length === 0) outcome = check ? (pos.turn === "w" ? "black" : "white") : "draw";
  return { pos: pos, labels: labels, legal: legalEnd, check: check, outcome: outcome };
}

function oppSide(c) {
  return c === "w" ? "b" : "w";
}

function gameSyncFlags(g) {
  var flags = 0;
  if (g.status === "active") flags |= SYNC_FLAG_ACTIVE;
  if (g.status === "finished") {
    flags |= SYNC_FLAG_FINISHED;
    if (g.winner === "w") flags |= SYNC_FLAG_WIN_W;
    else if (g.winner === "b") flags |= SYNC_FLAG_WIN_B;
    else if (g.winner === "draw") flags |= SYNC_FLAG_DRAW;
  }
  if (g.colorVerified && (g.myColor === "w" || g.myColor === "b")) {
    flags |= SYNC_FLAG_HAS_COLOR;
    if (g.myColor === "b") flags |= SYNC_FLAG_SENDER_B;
  }
  return flags;
}

function gamePosHash8(g) {
  var rep = replayMoves(g.moves || []);
  return posHash8(rep ? rep.pos : initialState());
}

function encodePacket(op, gameId, extra) {
  var out = new Uint8Array(3 + (extra ? extra.length : 0));
  out[0] = op & 0x1f;
  out[1] = gameId & 0xff;
  out[2] = (gameId >> 8) & 0xff;
  if (extra) out.set(extra, 3);
  return out;
}

function encodeInvite(gameId, myColor) {
  return encodePacket(OP_INVITE, gameId, [myColor === "b" ? 1 : 0, 0]);
}
function encodeAccept(gameId, myColor) {
  return encodePacket(OP_ACCEPT, gameId, [myColor === "b" ? 1 : 0]);
}
function encodeDecline(gameId) {
  return encodePacket(OP_DECLINE, gameId, []);
}
function encodeMovePkt(gameId, ply, moveBits, hash8) {
  return encodePacket(OP_MOVE, gameId, [ply & 0xff, (ply >> 8) & 0xff, moveBits & 0xff, (moveBits >> 8) & 0xff, hash8 & 0xff]);
}
function encodeActionPkt(gameId, ply, action) {
  return encodePacket(OP_ACTION, gameId, [ply & 0xff, (ply >> 8) & 0xff, action & 0xff]);
}
function encodeSyncReq(gameId, fromPly, hash8, flags) {
  if (typeof hash8 === "number") {
    return encodePacket(OP_SYNC_REQ, gameId, [fromPly & 0xff, (fromPly >> 8) & 0xff, hash8 & 0xff, (flags || 0) & 0xff]);
  }
  return encodePacket(OP_SYNC_REQ, gameId, [fromPly & 0xff, (fromPly >> 8) & 0xff]);
}
function encodeSyncMoves(gameId, fromPly, movesSlice, senderColor) {
  var count = Math.min(MAX_SYNC_CHUNK, movesSlice.length);
  var buf = new Uint8Array(3 + count * 2);
  buf[0] = fromPly & 0xff;
  buf[1] = (fromPly >> 8) & 0xff;
  buf[2] = count;
  for (var i = 0; i < count; i++) {
    buf[3 + i * 2] = movesSlice[i] & 0xff;
    buf[4 + i * 2] = (movesSlice[i] >> 8) & 0xff;
  }
  var pkt = encodePacket(OP_SYNC_MOVES, gameId, buf);
  if (senderColor === "w" || senderColor === "b") {
    pkt[0] |= HDR_HAS_COLOR | (senderColor === "b" ? HDR_SENDER_B : 0);
  }
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
  if (op === OP_INVITE && bytes.length >= 4) return { op: op, gameId: gameId, challengerColor: (bytes[3] & 1) ? "b" : "w" };
  if (op === OP_ACCEPT && bytes.length >= 4) return { op: op, gameId: gameId, accepterColor: (bytes[3] & 1) ? "b" : "w" };
  if (op === OP_DECLINE) return { op: op, gameId: gameId };
  if (op === OP_MOVE && bytes.length >= 8) return { op: op, gameId: gameId, ply: bytes[3] | (bytes[4] << 8), moveBits: bytes[5] | (bytes[6] << 8), hash8: bytes[7] };
  if (op === OP_ACTION && bytes.length >= 6) return { op: op, gameId: gameId, ply: bytes[3] | (bytes[4] << 8), action: bytes[5] };
  if (op === OP_SYNC_REQ && bytes.length >= 5) {
    var reqFlags = bytes.length >= 7 ? bytes[6] : 0;
    var reqColor = (reqFlags & SYNC_FLAG_HAS_COLOR) ? ((reqFlags & SYNC_FLAG_SENDER_B) ? "b" : "w") : null;
    return {
      op: op,
      gameId: gameId,
      fromPly: bytes[3] | (bytes[4] << 8),
      hash8: bytes.length >= 6 ? bytes[5] : null,
      flags: reqFlags,
      senderColor: reqColor
    };
  }
  if (op === OP_SYNC_MOVES && bytes.length >= 6) {
    var fromPly = bytes[3] | (bytes[4] << 8);
    var count = bytes[5];
    var moves = [];
    for (var i = 0; i < count && 6 + i * 2 + 1 < bytes.length; i++) {
      moves.push(bytes[6 + i * 2] | (bytes[7 + i * 2] << 8));
    }
    var syncColor = (bytes[0] & HDR_HAS_COLOR) ? ((bytes[0] & HDR_SENDER_B) ? "b" : "w") : null;
    return { op: op, gameId: gameId, fromPly: fromPly, moves: moves, senderColor: syncColor };
  }
  if (op === OP_CHAT && bytes.length > 3) {
    var txt = new TextDecoder().decode(bytes.subarray(3)).trim();
    if (!txt) return null;
    return { op: op, gameId: gameId, text: txt };
  }
  return null;
}

/**
 * Derives our ground-truth side ("w" or "b") from any packet whose sender color
 * is known (invite, accept, move ply parity, or verified sync metadata).
 */
function inferMyColor(decoded, mirrored) {
  if (decoded.op === OP_INVITE) return mirrored ? decoded.challengerColor : oppSide(decoded.challengerColor);
  if (decoded.op === OP_ACCEPT) return mirrored ? decoded.accepterColor : oppSide(decoded.accepterColor);
  if (decoded.op === OP_MOVE && decoded.ply > 0) {
    var mover = (decoded.ply % 2 === 1) ? "w" : "b";
    return mirrored ? mover : oppSide(mover);
  }
  if ((decoded.op === OP_SYNC_REQ || decoded.op === OP_SYNC_MOVES) && decoded.senderColor) {
    return mirrored ? decoded.senderColor : oppSide(decoded.senderColor);
  }
  return null;
}

/**
 * Self-heals a legacy game whose side was inverted (e.g. v1.3.1 mirrored OP_INVITE
 * on desktop sharing a phone's radio). Once verified, a game's side never flips again.
 */
function healGameColor(g, decoded, mirrored) {
  var inferred = inferMyColor(decoded, mirrored);
  if (!inferred || g.colorVerified) return false;
  g.colorVerified = true;
  if (g.myColor === inferred) return false;
  g.myColor = inferred;
  if (g.status === "finished" && (g.winner === "w" || g.winner === "b")) {
    var rep = replayMoves(g.moves || []);
    if (!rep || !rep.outcome) {
      g.winner = oppSide(g.winner);
    }
  }
  if (g.drawOfferedBy === "w" || g.drawOfferedBy === "b") {
    g.drawOfferedBy = oppSide(g.drawOfferedBy);
  }
  return true;
}

/** Repairs stored v1.3.1 outgoing invites saved on a mirrored device as Black. */
function normalizeStoredGames(games) {
  var changed = false;
  if (!games || typeof games !== "object") return false;
  var keys = Object.keys(games);
  for (var i = 0; i < keys.length; i++) {
    var g = games[keys[i]];
    if (!g || typeof g !== "object") continue;
    if (!g.colorVerified && g.status === "invited_out" && g.myColor === "b" && (!g.moves || g.moves.length === 0)) {
      g.myColor = "w";
      g.colorVerified = true;
      changed = true;
    }
  }
  return changed;
}

/**
 * Builds outbound sync packet(s) when the user taps Sync.
 * Always requests moves after our current ply (working even beyond 72 plies)
 * AND re-broadcasts our latest move/invite/accept/action when we may be ahead,
 * so EITHER player pressing Sync reconciles both sides — including against v1.3.1 peers.
 */
function buildManualSyncPackets(g) {
  var pkts = [];
  var hash8 = gamePosHash8(g);
  var flags = gameSyncFlags(g);
  var lastMover = g.moves.length > 0 ? ((g.moves.length % 2 === 1) ? "w" : "b") : null;

  if (g.status === "invited_out") {
    pkts.push(encodeInvite(g.gameId, g.myColor));
    pkts.push(encodeSyncReq(g.gameId, 0, hash8, flags));
    return pkts;
  }
  if (g.status === "active" && g.moves.length === 0 && g.myColor === "b") {
    pkts.push(encodeAccept(g.gameId, g.myColor));
  }
  // Only re-send the last OP_MOVE when WE actually played that move (preserves ply-parity invariant).
  if (g.moves.length > 0 && lastMover === g.myColor) {
    var lastMove = g.moves[g.moves.length - 1];
    pkts.push(encodeMovePkt(g.gameId, g.moves.length, lastMove, hash8));
  }
  if (g.status === "finished" && g.finishAction) {
    pkts.push(encodeActionPkt(g.gameId, g.moves.length, g.finishAction));
  }
  pkts.push(encodeSyncReq(g.gameId, g.moves.length, hash8, flags));
  return pkts;
}

function buildActivities(games, locale) {
  var ru = locale === "ru";
  return Object.values(games)
    .filter(function (g) { return g.status !== "declined"; })
    .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })
    .map(function (g) {
      var rep = replayMoves(g.moves || []) || { pos: initialState(), labels: [], outcome: null };
      var myTurn = g.status === "active" && rep.pos.turn === g.myColor;
      var lastMove = rep.labels.length ? rep.labels[rep.labels.length - 1] : "";
      var badge = null;
      var subtitle = "";
      var attention = false;
      if (g.status === "invited_in") {
        badge = { text: ru ? "Вызов" : "Invite", tone: "accent" };
        subtitle = ru ? "Приглашение в партию" : "Game invitation";
        attention = true;
      } else if (g.status === "invited_out") {
        badge = { text: ru ? "Ожидание" : "Pending", tone: "neutral" };
        subtitle = ru ? "Ждём подтверждения" : "Waiting for reply";
      } else if (g.status === "finished") {
        var win = g.winner === g.myColor;
        badge = g.winner === "draw"
          ? { text: ru ? "Ничья" : "Draw", tone: "neutral" }
          : { text: win ? (ru ? "Победа" : "Won") : (ru ? "Поражение" : "Lost"), tone: win ? "success" : "danger" };
        subtitle = lastMove ? (ru ? "Завершена • " : "Finished • ") + lastMove : (ru ? "Партия завершена" : "Game over");
      } else if (myTurn) {
        badge = { text: ru ? "Ваш ход" : "Your turn", tone: "success" };
        subtitle = lastMove ? (ru ? "Последний ход: " : "Last move: ") + lastMove : (ru ? "Партия началась" : "Game started");
        attention = true;
      } else {
        badge = { text: ru ? "Ход соперника" : "Waiting", tone: "neutral" };
        subtitle = lastMove ? (ru ? "Ваш ход: " : "Your move: ") + lastMove : (ru ? "Ждём первый ход" : "Waiting for move");
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
    // Mirrored frames came from our own secondary device; never echo replies to the opponent.
    if (mirrored) return;
    replies.push({ peerPrefix: packet.peerPrefix, payload: Array.from(payloadBytes), retry: true });
  }

  if (decoded.op === OP_INVITE) {
    if (!g) {
      var myColor = inferMyColor(decoded, mirrored) || "b";
      games[key] = {
        id: key,
        gameId: gid,
        peerPrefix: packet.peerPrefix,
        peerName: peerName,
        myColor: myColor,
        colorVerified: true,
        status: mirrored ? "invited_out" : "invited_in",
        moves: [],
        drawOfferedBy: null,
        winner: null,
        finishAction: null,
        updatedAt: now
      };
      if (!mirrored) notify = { body: ru ? "Приглашение в шахматы" : "Chess invitation", tag: "game:" + key, peerPrefix: packet.peerPrefix };
      return { changed: true, notify: notify, replies: replies, gameKey: key };
    }
    var invHealed = healGameColor(g, decoded, mirrored);
    if (invHealed) g.updatedAt = now;
    // Re-sent invite while we already accepted: re-send ACCEPT (and any moves) to heal stuck invited_out peer.
    if (!mirrored && (g.status === "active" || g.status === "finished")) {
      pushReply(encodeAccept(gid, g.myColor));
      if (g.moves.length > 0) pushReply(encodeSyncMoves(gid, 0, g.moves, g.colorVerified ? g.myColor : null));
      return { changed: invHealed, notify: null, replies: replies, gameKey: key };
    }
    return { changed: invHealed, notify: null, replies: [], gameKey: key };
  }

  var created = false;
  if (!g) {
    // Unknown gameId (e.g. fresh device or second device joining mid-game) -> derive side & recover history.
    var canCreate = decoded.op === OP_ACCEPT || decoded.op === OP_MOVE || decoded.op === OP_SYNC_MOVES ||
      (decoded.op === OP_SYNC_REQ && (mirrored || Boolean(decoded.senderColor)));
    if (canCreate) {
      var inferredColor = inferMyColor(decoded, mirrored);
      var initStatus = (decoded.op === OP_SYNC_REQ && !(decoded.flags & (SYNC_FLAG_ACTIVE | SYNC_FLAG_FINISHED)) && decoded.fromPly === 0)
        ? (mirrored ? "invited_out" : "invited_in")
        : "active";
      games[key] = {
        id: key, gameId: gid, peerPrefix: packet.peerPrefix, peerName: peerName,
        myColor: inferredColor || "b", colorVerified: Boolean(inferredColor),
        status: initStatus, moves: [], drawOfferedBy: null, winner: null, finishAction: null, updatedAt: now
      };
      g = games[key];
      created = true;
    } else {
      return { changed: false, notify: null, replies: [] };
    }
  }
  if (peerName && !mirrored) g.peerName = peerName;
  var colorHealed = healGameColor(g, decoded, mirrored);
  if (colorHealed) g.updatedAt = now;
  var baseChanged = created || colorHealed;
  var mySyncColor = g.colorVerified ? g.myColor : null;

  if (decoded.op === OP_ACCEPT) {
    if (g.status === "invited_out" || g.status === "invited_in") {
      g.status = "active";
      g.updatedAt = now;
      if (!mirrored) notify = { body: ru ? "Приглашение принято — можно ходить" : "Invite accepted", tag: "game:" + key, peerPrefix: packet.peerPrefix };
      return { changed: true, notify: notify, replies: replies, gameKey: key, synced: true };
    }
    return { changed: baseChanged, notify: null, replies: [], gameKey: key, synced: true };
  } else if (decoded.op === OP_DECLINE) {
    g.status = "declined";
    g.updatedAt = now;
    if (!mirrored) notify = { body: ru ? "Приглашение отклонено" : "Invite declined", tag: "game:" + key, peerPrefix: packet.peerPrefix };
    return { changed: true, notify: notify, replies: replies, gameKey: key };
  } else if (decoded.op === OP_MOVE) {
    var expectedPly = g.moves.length + 1;
    if (decoded.ply <= g.moves.length) {
      var changedSt = baseChanged;
      if (g.status === "invited_out" || g.status === "invited_in") {
        g.status = "active";
        g.updatedAt = now;
        changedSt = true;
      }
      // Same ply with a different move -> histories diverged, request full sync from ply 0.
      if (decoded.ply > 0 && g.moves[decoded.ply - 1] !== decoded.moveBits) {
        pushReply(encodeSyncReq(gid, 0, gamePosHash8(g), gameSyncFlags(g)));
        return { changed: changedSt, notify: null, replies: replies, gameKey: key };
      }
      // Peer re-sent an older move while we already have newer moves -> push our tail immediately!
      if (decoded.ply < g.moves.length) {
        pushReply(encodeSyncMoves(gid, decoded.ply, g.moves.slice(decoded.ply), mySyncColor));
        if (g.status === "finished" && g.finishAction) pushReply(encodeActionPkt(gid, g.moves.length, g.finishAction));
      }
      return { changed: changedSt, notify: null, replies: replies, gameKey: key };
    }
    if (decoded.ply > expectedPly) {
      pushReply(encodeSyncReq(gid, g.moves.length, gamePosHash8(g), gameSyncFlags(g)));
      return { changed: baseChanged, notify: null, replies: replies, gameKey: key };
    }
    var candidate = g.moves.concat([decoded.moveBits]);
    var rep = replayMoves(candidate);
    if (!rep || posHash8(rep.pos) !== decoded.hash8) {
      pushReply(encodeSyncReq(gid, 0, gamePosHash8(g), gameSyncFlags(g)));
      return { changed: baseChanged, notify: null, replies: replies, gameKey: key };
    }
    g.moves = candidate;
    g.status = rep.outcome ? "finished" : "active";
    if (rep.outcome) {
      g.winner = rep.outcome === "white" ? "w" : rep.outcome === "black" ? "b" : "draw";
      g.finishAction = null;
    }
    var u = unpackMove(decoded.moveBits);
    g.drawOfferedBy = u.offerDraw ? (mirrored ? g.myColor : (g.myColor === "w" ? "b" : "w")) : null;
    g.updatedAt = now;
    var label = rep.labels[rep.labels.length - 1] || "";
    if (!mirrored) {
      notify = {
        body: (ru ? "Ваш ход: " : "Your turn: ") + label,
        tag: "game:" + key,
        peerPrefix: packet.peerPrefix
      };
    }
    return { changed: true, notify: notify, replies: replies, gameKey: key };
  } else if (decoded.op === OP_ACTION) {
    if (decoded.action === ACT_RESIGN) {
      var nextWinner = mirrored ? (g.myColor === "w" ? "b" : "w") : g.myColor;
      if (g.status === "finished" && g.winner === nextWinner) return { changed: baseChanged, notify: null, replies: [], gameKey: key, synced: true };
      g.status = "finished";
      g.winner = nextWinner;
      g.finishAction = mirrored ? ACT_RESIGN : null;
      g.updatedAt = now;
      if (!mirrored) notify = { body: ru ? "Соперник сдался — вы победили!" : "Opponent resigned — you win!", tag: "game:" + key, peerPrefix: packet.peerPrefix };
      return { changed: true, notify: notify, replies: replies, gameKey: key, synced: true };
    } else if (decoded.action === ACT_DRAW_OFFER) {
      g.drawOfferedBy = mirrored ? g.myColor : (g.myColor === "w" ? "b" : "w");
      g.updatedAt = now;
      if (!mirrored) notify = { body: ru ? "Предложена ничья" : "Draw offered", tag: "game:" + key, peerPrefix: packet.peerPrefix };
      return { changed: true, notify: notify, replies: replies, gameKey: key };
    } else if (decoded.action === ACT_DRAW_ACCEPT) {
      if (g.status === "finished" && g.winner === "draw") return { changed: baseChanged, notify: null, replies: [], gameKey: key, synced: true };
      g.status = "finished";
      g.winner = "draw";
      g.finishAction = ACT_DRAW_ACCEPT;
      g.drawOfferedBy = null;
      g.updatedAt = now;
      if (!mirrored) notify = { body: ru ? "Партия завершена вничью" : "Game drawn", tag: "game:" + key, peerPrefix: packet.peerPrefix };
      return { changed: true, notify: notify, replies: replies, gameKey: key, synced: true };
    } else if (decoded.action === ACT_DRAW_DECLINE) {
      g.drawOfferedBy = null;
      g.updatedAt = now;
      return { changed: true, notify: null, replies: replies, gameKey: key };
    }
  } else if (decoded.op === OP_SYNC_REQ) {
    var changedReq = baseChanged;
    var ourHash = gamePosHash8(g);
    var ourFlags = gameSyncFlags(g);
    if (g.status === "invited_out" && ((decoded.flags & (SYNC_FLAG_ACTIVE | SYNC_FLAG_FINISHED)) !== 0 || decoded.fromPly > 0)) {
      g.status = "active";
      g.updatedAt = now;
      changedReq = true;
    }
    if (mirrored && (decoded.flags & SYNC_FLAG_FINISHED) && decoded.fromPly === g.moves.length) {
      var mirWin = (decoded.flags & SYNC_FLAG_WIN_W) ? "w" : (decoded.flags & SYNC_FLAG_WIN_B) ? "b" : (decoded.flags & SYNC_FLAG_DRAW) ? "draw" : null;
      if (mirWin && (g.status !== "finished" || g.winner !== mirWin)) {
        g.status = "finished";
        g.winner = mirWin;
        g.updatedAt = now;
        changedReq = true;
      }
    }
    if (decoded.fromPly < g.moves.length) {
      var slice = g.moves.slice(decoded.fromPly);
      pushReply(encodeSyncMoves(gid, decoded.fromPly, slice, mySyncColor));
      if (g.status === "finished" && g.finishAction && decoded.fromPly + slice.length >= g.moves.length) {
        pushReply(encodeActionPkt(gid, g.moves.length, g.finishAction));
      }
    } else if (decoded.fromPly > g.moves.length) {
      // Peer is ahead of us -> ask them for everything after our ply.
      pushReply(encodeSyncReq(gid, g.moves.length, ourHash, ourFlags));
    } else {
      // Same ply count: check for missed accept, hash divergence, finished action, or confirm in-sync.
      if (decoded.fromPly === 0 && g.status === "active" && g.myColor === "b") {
        pushReply(encodeAccept(gid, g.myColor));
      } else if (decoded.hash8 !== null && decoded.hash8 !== ourHash) {
        // Diverged history at equal ply -> send full history from ply 0.
        pushReply(encodeSyncMoves(gid, 0, g.moves, mySyncColor));
      } else {
        if (g.status === "finished" && g.finishAction) {
          pushReply(encodeActionPkt(gid, g.moves.length, g.finishAction));
        }
        // Send a 0-move confirmation so the requester knows both sides match.
        pushReply(encodeSyncMoves(gid, g.moves.length, [], mySyncColor));
      }
    }
    return { changed: changedReq, notify: null, replies: replies, gameKey: key };
  } else if (decoded.op === OP_SYNC_MOVES) {
    // Gap between our history and incoming chunk -> request starting from our own ply.
    if (decoded.fromPly > g.moves.length) {
      pushReply(encodeSyncReq(gid, g.moves.length, gamePosHash8(g), gameSyncFlags(g)));
      return { changed: baseChanged, notify: null, replies: replies, gameKey: key };
    }
    // 0-move confirmation from peer at our ply: no further replies (prevents ping-pong).
    if (decoded.moves.length === 0) {
      var activated = baseChanged;
      if (g.status === "invited_out") {
        g.status = "active";
        g.updatedAt = now;
        activated = true;
      }
      return { changed: activated, notify: null, replies: [], gameKey: key, synced: true };
    }
    var base = g.moves.slice(0, decoded.fromPly);
    var merged = base.concat(decoded.moves);
    var repSync = replayMoves(merged);
    if (!repSync) {
      // Local prefix before fromPly diverged from peer -> ask for full history from ply 0.
      if (decoded.fromPly > 0) {
        pushReply(encodeSyncReq(gid, 0, gamePosHash8(g), gameSyncFlags(g)));
      }
      return { changed: baseChanged, notify: null, replies: replies, gameKey: key };
    }
    if (merged.length > g.moves.length) {
      g.moves = merged;
      g.status = repSync.outcome ? "finished" : "active";
      if (repSync.outcome) {
        g.winner = repSync.outcome === "white" ? "w" : repSync.outcome === "black" ? "b" : "draw";
        g.finishAction = null;
      }
      g.updatedAt = now;
      // If peer sent a full 72-ply chunk, more moves may follow — pull the next chunk immediately.
      if (decoded.moves.length >= MAX_SYNC_CHUNK) {
        pushReply(encodeSyncReq(gid, g.moves.length, posHash8(repSync.pos), gameSyncFlags(g)));
      }
      return { changed: true, notify: null, replies: replies, gameKey: key, synced: true };
    }
    if (merged.length === g.moves.length) {
      var differs = false;
      for (var mi = 0; mi < merged.length; mi++) {
        if (merged[mi] !== g.moves[mi]) { differs = true; break; }
      }
      var becameActive = g.status === "invited_out";
      if (differs || becameActive) {
        // Reconcile divergent equal-length history (fromPly === 0) or finalize pending invite.
        if (differs && decoded.fromPly === 0) {
          g.moves = merged;
          if (repSync.outcome) {
            g.status = "finished";
            g.winner = repSync.outcome === "white" ? "w" : repSync.outcome === "black" ? "b" : "draw";
            g.finishAction = null;
          } else {
            g.status = "active";
          }
        } else if (becameActive) {
          g.status = repSync.outcome ? "finished" : "active";
        }
        g.updatedAt = now;
      }
      if (decoded.moves.length >= MAX_SYNC_CHUNK) {
        pushReply(encodeSyncReq(gid, g.moves.length, posHash8(repSync.pos), gameSyncFlags(g)));
      }
      return { changed: baseChanged || differs || becameActive, notify: null, replies: replies, gameKey: key, synced: true };
    }
    // merged.length < g.moves.length: peer is behind us! Push only the moves they are missing.
    // Guard against truncated 72-move chunks (if they sent 72 moves from 0, don't assume they stopped at 72).
    if (decoded.moves.length < MAX_SYNC_CHUNK) {
      pushReply(encodeSyncMoves(gid, merged.length, g.moves.slice(merged.length), mySyncColor));
      if (g.status === "finished" && g.finishAction) pushReply(encodeActionPkt(gid, g.moves.length, g.finishAction));
    }
    return { changed: baseChanged, notify: null, replies: replies, gameKey: key };
  } else if (decoded.op === OP_CHAT) {
    if (!Array.isArray(g.chat)) g.chat = [];
    var fromSide = mirrored ? "me" : "opp";
    var ts = packet.timestamp || Math.floor(now / 1000);
    var dup = g.chat.some(function (m) {
      return m.from === fromSide && m.text === decoded.text && Math.abs((m.ts || 0) - ts) <= 5;
    });
    if (dup) return { changed: baseChanged, notify: null, replies: [] };
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
    return { changed: true, notify: notify, replies: replies, gameKey: key, isChat: true };
  }
  return { changed: baseChanged, notify: null, replies: replies };
}
