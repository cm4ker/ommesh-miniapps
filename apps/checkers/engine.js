var OP_INVITE = 1, OP_ACCEPT = 2, OP_DECLINE = 3, OP_MOVE = 4, OP_ACTION = 5, OP_SYNC_REQ = 6, OP_SYNC_MOVES = 7, OP_CHAT = 8;
var MAX_CHAT_UTF8 = 147;
var MAX_SYNC_PAYLOAD = 150;
var ACT_RESIGN = 1, ACT_DRAW_OFFER = 2, ACT_DRAW_ACCEPT = 3, ACT_DRAW_DECLINE = 4;
var SYNC_FLAG_ACTIVE = 1, SYNC_FLAG_FINISHED = 2, SYNC_FLAG_WIN_W = 4, SYNC_FLAG_WIN_B = 8, SYNC_FLAG_DRAW = 16;
var SYNC_FLAG_HAS_COLOR = 32, SYNC_FLAG_SENDER_B = 64;
var HDR_HAS_COLOR = 0x20, HDR_SENDER_B = 0x40;
var MOVE_MULTI_BIT = 0x4000, MOVE_DRAW_BIT = 0x8000;
var DRAW_QUIET_PLIES = 60;

function isDarkSq(sq) {
  return (((sq >> 3) + (sq & 7)) & 1) === 0;
}

function sq64To32(sq) {
  return ((sq >> 3) << 2) | ((sq & 7) >> 1);
}

function sq32To64(idx) {
  var r = (idx >> 2) & 7;
  var f = ((idx & 3) << 1) | (r & 1);
  return (r << 3) | f;
}

function sqName(sq) {
  return "abcdefgh"[sq & 7] + String((sq >> 3) + 1);
}

function pieceColor(ch) {
  if (!ch) return "";
  return ch === ch.toUpperCase() ? "w" : "b";
}

function isKing(ch) {
  return ch === "K" || ch === "k";
}

function oppSide(c) {
  return c === "w" ? "b" : "w";
}

function initialState() {
  var b = new Array(64).fill("");
  for (var r = 0; r < 8; r++) {
    for (var f = 0; f < 8; f++) {
      if (((r + f) & 1) !== 0) continue;
      var sq = (r << 3) | f;
      if (r <= 2) b[sq] = "M";
      else if (r >= 5) b[sq] = "m";
    }
  }
  return { board: b, turn: "w", quiet: 0, ply: 0 };
}

function clonePos(p) {
  return { board: p.board.slice(), turn: p.turn, quiet: p.quiet, ply: p.ply };
}

function posHash8(p) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < 64; i++) {
    var c = p.board[i] ? p.board[i].charCodeAt(0) : 46;
    h = Math.imul(h ^ c, 16777619) >>> 0;
  }
  h = Math.imul(h ^ (p.turn === "w" ? 1 : 2), 16777619) >>> 0;
  h = Math.imul(h ^ (p.quiet & 0xff), 16777619) >>> 0;
  return h & 0xff;
}

function countPieces(board) {
  var wm = 0, wk = 0, bm = 0, bk = 0;
  for (var i = 0; i < 64; i++) {
    var ch = board[i];
    if (ch === "M") wm++;
    else if (ch === "K") wk++;
    else if (ch === "m") bm++;
    else if (ch === "k") bk++;
  }
  return { wm: wm, wk: wk, bm: bm, bk: bk, w: wm + wk, b: bm + bk };
}

/**
 * Generates all legal Russian draughts (8x8) moves for `p.turn`.
 * - Men capture both forward and backward; kings fly any distance.
 * - Capturing is mandatory; any available capture sequence may be chosen,
 *   but a chosen sequence must continue until no further captures exist.
 * - Turkish strike: captured pieces stay on the board until the end of the turn
 *   and cannot be jumped or landed on again during the same turn.
 * - Promotion mid-capture: a man reaching the promotion rank during a capture
 *   immediately promotes to a king and continues capturing as a king if possible.
 */
function legalMoves(p) {
  var color = p.turn;
  var enemy = oppSide(color);
  var promoRank = color === "w" ? 7 : 0;
  var kingChar = color === "w" ? "K" : "k";
  var dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  var captures = [];

  for (var sq = 0; sq < 64; sq++) {
    var pc = p.board[sq];
    if (!pc || pieceColor(pc) !== color) continue;

    var workBoard = p.board.slice();
    workBoard[sq] = "";

    (function searchCaptures(curSq, curPiece, path, caps, capSet) {
      var f = curSq & 7;
      var r = curSq >> 3;
      var king = isKing(curPiece);
      var foundAny = false;

      if (!king) {
        for (var d = 0; d < 4; d++) {
          var dr = dirs[d][0], df = dirs[d][1];
          var mr = r + dr, mf = f + df;
          var lr = r + 2 * dr, lf = f + 2 * df;
          if (lr < 0 || lr > 7 || lf < 0 || lf > 7) continue;
          var mid = (mr << 3) | mf;
          var land = (lr << 3) | lf;
          var midPc = workBoard[mid];
          if (!midPc || pieceColor(midPc) !== enemy || capSet[mid]) continue;
          if (workBoard[land] !== "") continue;

          foundAny = true;
          var nextPiece = (lr === promoRank) ? kingChar : curPiece;
          var nextSet = Object.assign({}, capSet);
          nextSet[mid] = true;
          var nextPath = path.concat([land]);
          var nextCaps = caps.concat([mid]);
          if (!searchCaptures(land, nextPiece, nextPath, nextCaps, nextSet)) {
            captures.push({ path: nextPath, captures: nextCaps, promoted: !isKing(pc) && isKing(nextPiece) });
          }
        }
      } else {
        for (var kd = 0; kd < 4; kd++) {
          var kdr = dirs[kd][0], kdf = dirs[kd][1];
          var cr = r + kdr, cf = f + kdf;
          var enemySq = -1;
          while (cr >= 0 && cr < 8 && cf >= 0 && cf < 8) {
            var csq = (cr << 3) | cf;
            var cpc = workBoard[csq];
            if (cpc) {
              if (pieceColor(cpc) === enemy && !capSet[csq]) enemySq = csq;
              break;
            }
            cr += kdr;
            cf += kdf;
          }
          if (enemySq < 0) continue;

          var lands = [];
          cr += kdr;
          cf += kdf;
          while (cr >= 0 && cr < 8 && cf >= 0 && cf < 8) {
            var lsq = (cr << 3) | cf;
            if (workBoard[lsq] !== "") break;
            lands.push(lsq);
            cr += kdr;
            cf += kdf;
          }
          if (lands.length === 0) continue;

          foundAny = true;
          var nextKSet = Object.assign({}, capSet);
          nextKSet[enemySq] = true;
          var nextKCaps = caps.concat([enemySq]);
          var continuedIndices = [];
          for (var li = 0; li < lands.length; li++) {
            if (searchCaptures(lands[li], curPiece, path.concat([lands[li]]), nextKCaps, nextKSet)) {
              continuedIndices.push(li);
            }
          }
          // Under Russian rules, a flying king must land on a square that permits continuing the capture if any exists.
          if (continuedIndices.length === 0) {
            for (var lj = 0; lj < lands.length; lj++) {
              captures.push({ path: path.concat([lands[lj]]), captures: nextKCaps, promoted: !isKing(pc) && isKing(curPiece) });
            }
          }
        }
      }
      return foundAny;
    })(sq, pc, [sq], [], {});
  }

  if (captures.length > 0) return captures;

  var quietMoves = [];
  var fwdDir = color === "w" ? 1 : -1;
  for (var qsq = 0; qsq < 64; qsq++) {
    var qpc = p.board[qsq];
    if (!qpc || pieceColor(qpc) !== color) continue;
    var qf = qsq & 7;
    var qr = qsq >> 3;
    if (!isKing(qpc)) {
      var nr = qr + fwdDir;
      if (nr >= 0 && nr < 8) {
        if (qf > 0 && p.board[(nr << 3) | (qf - 1)] === "") {
          quietMoves.push({ path: [qsq, (nr << 3) | (qf - 1)], captures: [], promoted: nr === promoRank });
        }
        if (qf < 7 && p.board[(nr << 3) | (qf + 1)] === "") {
          quietMoves.push({ path: [qsq, (nr << 3) | (qf + 1)], captures: [], promoted: nr === promoRank });
        }
      }
    } else {
      for (var qd = 0; qd < 4; qd++) {
        var qdr = dirs[qd][0], qdf = dirs[qd][1];
        var tr = qr + qdr, tf = qf + qdf;
        while (tr >= 0 && tr < 8 && tf >= 0 && tf < 8) {
          var tsq = (tr << 3) | tf;
          if (p.board[tsq] !== "") break;
          quietMoves.push({ path: [qsq, tsq], captures: [], promoted: false });
          tr += qdr;
          tf += qdf;
        }
      }
    }
  }
  return quietMoves;
}

function samePath(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function applyLegalMove(p, move) {
  var next = clonePos(p);
  var from = move.path[0];
  var to = move.path[move.path.length - 1];
  var pc = next.board[from];
  var color = pieceColor(pc);
  var promoRank = color === "w" ? 7 : 0;
  var kingChar = color === "w" ? "K" : "k";
  var becameKing = isKing(pc);

  next.board[from] = "";
  for (var i = 0; i < move.captures.length; i++) {
    next.board[move.captures[i]] = "";
  }
  for (var j = 1; j < move.path.length; j++) {
    if ((move.path[j] >> 3) === promoRank) becameKing = true;
  }
  next.board[to] = becameKing ? kingChar : pc;
  next.quiet = (move.captures.length > 0 || !isKing(pc)) ? 0 : p.quiet + 1;
  next.turn = oppSide(color);
  next.ply = p.ply + 1;
  return next;
}

function formatMoveLabel(move) {
  var sep = move.captures.length > 0 ? ":" : "-";
  var parts = [];
  for (var i = 0; i < move.path.length; i++) parts.push(sqName(move.path[i]));
  return parts.join(sep);
}

/**
 * Each stored move in `g.moves` is `{ p: number[], d?: boolean }` (path of dark-square indices 0..31,
 * optional draw offer) or a plain array of `sq32` indices for compact storage.
 */
function movePath32(m) {
  if (Array.isArray(m)) return m;
  return m && Array.isArray(m.p) ? m.p : [];
}

function moveOfferDraw(m) {
  return !!(m && !Array.isArray(m) && m.d);
}

function sameStoredMove(a, b) {
  return samePath(movePath32(a), movePath32(b)) && moveOfferDraw(a) === moveOfferDraw(b);
}

function encodeMoveRecord(path32, offerDraw) {
  var w = (path32[0] & 31) | ((path32[1] & 31) << 5) | (path32.length > 2 ? MOVE_MULTI_BIT : 0) | (offerDraw ? MOVE_DRAW_BIT : 0);
  if (path32.length <= 2) {
    return [w & 0xff, (w >> 8) & 0xff];
  }
  var extra = Math.min(12, path32.length - 2);
  var out = [w & 0xff, (w >> 8) & 0xff, extra];
  for (var i = 0; i < extra; i++) out.push(path32[2 + i] & 31);
  return out;
}

function decodeMoveRecord(bytes, offset) {
  if (offset + 2 > bytes.length) return null;
  var w = bytes[offset] | (bytes[offset + 1] << 8);
  var path = [w & 31, (w >> 5) & 31];
  var offerDraw = (w & MOVE_DRAW_BIT) !== 0;
  var consumed = 2;
  if ((w & MOVE_MULTI_BIT) !== 0) {
    if (offset + 3 > bytes.length) return null;
    var extra = bytes[offset + 2];
    if (extra < 1 || extra > 12 || offset + 3 + extra > bytes.length) return null;
    for (var i = 0; i < extra; i++) path.push(bytes[offset + 3 + i] & 31);
    consumed = 3 + extra;
  }
  return { move: offerDraw ? { p: path, d: true } : path, nextOffset: offset + consumed };
}

function replayMoves(storedMoves) {
  var pos = initialState();
  var labels = [];
  for (var i = 0; i < storedMoves.length; i++) {
    var p32 = movePath32(storedMoves[i]);
    if (p32.length < 2) return null;
    var p64 = [];
    for (var k = 0; k < p32.length; k++) {
      if (p32[k] < 0 || p32[k] > 31) return null;
      p64.push(sq32To64(p32[k]));
    }
    var legal = legalMoves(pos);
    var match = null;
    for (var j = 0; j < legal.length; j++) {
      if (samePath(legal[j].path, p64)) { match = legal[j]; break; }
    }
    if (!match) return null;
    labels.push(formatMoveLabel(match));
    pos = applyLegalMove(pos, match);
  }
  var legalEnd = legalMoves(pos);
  var outcome = null;
  if (legalEnd.length === 0) {
    outcome = pos.turn === "w" ? "black" : "white";
  } else if (pos.quiet >= DRAW_QUIET_PLIES) {
    outcome = "draw";
  }
  var mustCapture = legalEnd.length > 0 && legalEnd[0].captures.length > 0;
  return { pos: pos, labels: labels, legal: legalEnd, mustCapture: mustCapture, outcome: outcome };
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

function encodeMovePkt(gameId, ply, storedMove, hash8) {
  var rec = encodeMoveRecord(movePath32(storedMove), moveOfferDraw(storedMove));
  var extra = new Uint8Array(2 + rec.length + 1);
  extra[0] = ply & 0xff;
  extra[1] = (ply >> 8) & 0xff;
  for (var i = 0; i < rec.length; i++) extra[2 + i] = rec[i];
  extra[2 + rec.length] = hash8 & 0xff;
  return encodePacket(OP_MOVE, gameId, extra);
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
  var body = [];
  var count = 0;
  var maxBody = MAX_SYNC_PAYLOAD - 6;
  var truncated = false;
  for (var i = 0; i < movesSlice.length && count < 255; i++) {
    var rec = encodeMoveRecord(movePath32(movesSlice[i]), moveOfferDraw(movesSlice[i]));
    if (body.length + rec.length > maxBody) {
      truncated = true;
      break;
    }
    for (var j = 0; j < rec.length; j++) body.push(rec[j]);
    count++;
  }
  var buf = new Uint8Array(3 + body.length);
  buf[0] = fromPly & 0xff;
  buf[1] = (fromPly >> 8) & 0xff;
  buf[2] = count;
  for (var k = 0; k < body.length; k++) buf[3 + k] = body[k];
  var pkt = encodePacket(OP_SYNC_MOVES, gameId, buf);
  if (senderColor === "w" || senderColor === "b") {
    pkt[0] |= HDR_HAS_COLOR | (senderColor === "b" ? HDR_SENDER_B : 0);
  }
  if (truncated) pkt[0] |= 0x80;
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
  if (op === OP_MOVE && bytes.length >= 8) {
    var ply = bytes[3] | (bytes[4] << 8);
    var rec = decodeMoveRecord(bytes, 5);
    if (!rec || rec.nextOffset + 1 > bytes.length) return null;
    return { op: op, gameId: gameId, ply: ply, move: rec.move, hash8: bytes[rec.nextOffset] };
  }
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
    var off = 6;
    for (var i = 0; i < count && off < bytes.length; i++) {
      var dr = decodeMoveRecord(bytes, off);
      if (!dr) break;
      moves.push(dr.move);
      off = dr.nextOffset;
    }
    var syncColor = (bytes[0] & HDR_HAS_COLOR) ? ((bytes[0] & HDR_SENDER_B) ? "b" : "w") : null;
    var hasMore = (bytes[0] & 0x80) !== 0;
    return { op: op, gameId: gameId, fromPly: fromPly, moves: moves, senderColor: syncColor, hasMore: hasMore };
  }
  if (op === OP_CHAT && bytes.length > 3) {
    var txt = new TextDecoder().decode(bytes.subarray(3)).trim();
    if (!txt) return null;
    return { op: op, gameId: gameId, text: txt };
  }
  return null;
}

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

function healGameColor(g, decoded, mirrored) {
  var inferred = inferMyColor(decoded, mirrored);
  if (!inferred || g.colorVerified) return false;
  g.colorVerified = true;
  if (g.myColor === inferred) return false;
  g.myColor = inferred;
  if (g.status === "finished" && (g.winner === "w" || g.winner === "b")) {
    var rep = replayMoves(g.moves || []);
    if (!rep || !rep.outcome) g.winner = oppSide(g.winner);
  }
  if (g.drawOfferedBy === "w" || g.drawOfferedBy === "b") g.drawOfferedBy = oppSide(g.drawOfferedBy);
  return true;
}

function normalizeStoredGames(games) {
  var changed = false;
  if (!games || typeof games !== "object") return false;
  var keys = Object.keys(games);
  for (var i = 0; i < keys.length; i++) {
    var g = games[keys[i]];
    if (!g || typeof g !== "object") continue;
    if (!Array.isArray(g.moves)) { g.moves = []; changed = true; }
  }
  return changed;
}

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
  if (g.moves.length > 0 && lastMover === g.myColor) {
    pkts.push(encodeMovePkt(g.gameId, g.moves.length, g.moves[g.moves.length - 1], hash8));
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
        subtitle = ru ? "Приглашение в шашки" : "Checkers invitation";
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
      if (!mirrored) notify = { body: ru ? "Приглашение в шашки" : "Checkers invitation", tag: "game:" + key, peerPrefix: packet.peerPrefix };
      return { changed: true, notify: notify, replies: replies, gameKey: key };
    }
    var invHealed = healGameColor(g, decoded, mirrored);
    if (invHealed) g.updatedAt = now;
    if (!mirrored && (g.status === "active" || g.status === "finished")) {
      pushReply(encodeAccept(gid, g.myColor));
      if (g.moves.length > 0) pushReply(encodeSyncMoves(gid, 0, g.moves, g.colorVerified ? g.myColor : null));
      return { changed: invHealed, notify: null, replies: replies, gameKey: key };
    }
    return { changed: invHealed, notify: null, replies: [], gameKey: key };
  }

  var created = false;
  if (!g) {
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
      if (decoded.ply > 0 && !sameStoredMove(g.moves[decoded.ply - 1], decoded.move)) {
        pushReply(encodeSyncReq(gid, 0, gamePosHash8(g), gameSyncFlags(g)));
        return { changed: changedSt, notify: null, replies: replies, gameKey: key };
      }
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
    var candidate = g.moves.concat([decoded.move]);
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
    g.drawOfferedBy = moveOfferDraw(decoded.move) ? (mirrored ? g.myColor : oppSide(g.myColor)) : null;
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
      var nextWinner = mirrored ? oppSide(g.myColor) : g.myColor;
      if (g.status === "finished" && g.winner === nextWinner) return { changed: baseChanged, notify: null, replies: [], gameKey: key, synced: true };
      g.status = "finished";
      g.winner = nextWinner;
      g.finishAction = mirrored ? ACT_RESIGN : null;
      g.updatedAt = now;
      if (!mirrored) notify = { body: ru ? "Соперник сдался — вы победили!" : "Opponent resigned — you win!", tag: "game:" + key, peerPrefix: packet.peerPrefix };
      return { changed: true, notify: notify, replies: replies, gameKey: key, synced: true };
    } else if (decoded.action === ACT_DRAW_OFFER) {
      g.drawOfferedBy = mirrored ? g.myColor : oppSide(g.myColor);
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
      var syncPkt = encodeSyncMoves(gid, decoded.fromPly, slice, mySyncColor);
      pushReply(syncPkt);
      if (g.status === "finished" && g.finishAction && (syncPkt[0] & 0x80) === 0) {
        pushReply(encodeActionPkt(gid, g.moves.length, g.finishAction));
      }
    } else if (decoded.fromPly > g.moves.length) {
      pushReply(encodeSyncReq(gid, g.moves.length, ourHash, ourFlags));
    } else {
      if (decoded.fromPly === 0 && g.status === "active" && g.myColor === "b") {
        pushReply(encodeAccept(gid, g.myColor));
      } else if (decoded.hash8 !== null && decoded.hash8 !== ourHash) {
        pushReply(encodeSyncMoves(gid, 0, g.moves, mySyncColor));
      } else {
        if (g.status === "finished" && g.finishAction) {
          pushReply(encodeActionPkt(gid, g.moves.length, g.finishAction));
        }
        pushReply(encodeSyncMoves(gid, g.moves.length, [], mySyncColor));
      }
    }
    return { changed: changedReq, notify: null, replies: replies, gameKey: key };
  } else if (decoded.op === OP_SYNC_MOVES) {
    if (decoded.fromPly > g.moves.length) {
      pushReply(encodeSyncReq(gid, g.moves.length, gamePosHash8(g), gameSyncFlags(g)));
      return { changed: baseChanged, notify: null, replies: replies, gameKey: key };
    }
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
      if (decoded.hasMore) {
        pushReply(encodeSyncReq(gid, g.moves.length, posHash8(repSync.pos), gameSyncFlags(g)));
      }
      return { changed: true, notify: null, replies: replies, gameKey: key, synced: true };
    }
    if (merged.length === g.moves.length) {
      var differs = false;
      for (var mi = 0; mi < merged.length; mi++) {
        if (!sameStoredMove(merged[mi], g.moves[mi])) { differs = true; break; }
      }
      var becameActive = g.status === "invited_out";
      if (differs || becameActive) {
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
      if (decoded.hasMore) {
        pushReply(encodeSyncReq(gid, g.moves.length, posHash8(repSync.pos), gameSyncFlags(g)));
      }
      return { changed: baseChanged || differs || becameActive, notify: null, replies: replies, gameKey: key, synced: true };
    }
    if (!decoded.hasMore) {
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
