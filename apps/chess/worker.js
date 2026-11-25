/* @include ./engine.js */

self.onPacket = function (input) {
  var games = (input.storage && input.storage.games && typeof input.storage.games === "object")
    ? JSON.parse(JSON.stringify(input.storage.games))
    : {};
  var normalized = normalizeStoredGames(games);
  var res = applyIncomingPacket(games, input.packet, input.locale || "ru");
  var out = {};
  if (normalized || res.changed) {
    out.storageSet = { games: games };
    out.activities = buildActivities(games, input.locale || "ru");
  }
  if (res.notify) out.notify = res.notify;
  if (res.replies && res.replies.length) out.send = res.replies;
  return out;
};
