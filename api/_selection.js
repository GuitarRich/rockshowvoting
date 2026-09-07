import { WEIGHTS, MAX_PER_ARTIST, lenSecs } from "../setlist.js";

// Same numbers the results page runs on: a 90-minute set, 25 seconds of
// shuffling between songs.
export const TARGET = 90 * 60;
export const GAP = 25;

/**
 * Which songs are actually in the set.
 *
 * Three things can override the vote, in this order:
 *
 *   force OUT    always beats everything, including a locked request.
 *   force IN     always in, whatever it scored and whatever the limits say.
 *   locked set   a frozen snapshot: the list stops moving as votes come in.
 *
 * With none of those in play, selection is PURE TOTAL SCORE — locked requests
 * go in, then the highest scorers until the limit is reached. Nothing is
 * promoted or demoted against the vote. It stops at selection: ordering is a
 * separate pass on the results page, because whether you have to learn a song
 * has nothing to do with which slot it lands in.
 *
 * The limit is a song count when `maxSongs` is set, and the 90 minutes
 * otherwise. A count deliberately ignores the clock — the runtime it lands on
 * is reported, not enforced.
 */
export function selectSet(rows, roster, opts = {}) {
  const maxPerArtist =
    opts.maxPerArtist === undefined ? MAX_PER_ARTIST : opts.maxPerArtist;
  const weights = opts.weights || WEIGHTS;
  const settings = opts.settings || {};
  const maxSongs = Math.max(0, Number(settings.maxSongs) || 0);
  const byKey = new Map(rows.map((r) => [r.k, r]));
  const forcedIn = rows.filter((r) => r.force === "IN").map((r) => r.k);
  const forcedOut = new Set(rows.filter((r) => r.force === "OUT").map((r) => r.k));

  const scored = rows.map((r) => {
    let score = 0;
    let musts = 0;
    let xs = 0;
    for (const name of roster) {
      const v = String(r.votes[name] || "").toUpperCase();
      if (v === "X") {
        xs++;
        continue;
      }
      if (weights[v] !== undefined) score += weights[v];
      if (v === "MUST") musts++;
    }
    return {
      k: r.k,
      artist: r.artist,
      secs: lenSecs(r.len),
      energy: Number(r.energy) || 0,
      isLocked: /^LOCKED/i.test(r.section),
      isPick: /pick ONE/i.test(r.section),
      score,
      musts,
      xs,
    };
  });

  const scoredBy = new Map(scored.map((s) => [s.k, s]));
  const chosen = [];
  const inSet = new Set();
  const secsOf = (keys) =>
    [...keys].reduce((a, k) => a + ((scoredBy.get(k) || {}).secs || 0) + GAP, 0);
  const take = (s) => {
    if (!s || inSet.has(s.k) || forcedOut.has(s.k)) return;
    chosen.push(s);
    inSet.add(s.k);
  };

  // A frozen set answers straight away. Forces still apply on top, so a locked
  // list can be corrected without unlocking and losing it.
  if (settings.locked && (settings.lockedKeys || []).length) {
    const frozen = new Set(
      settings.lockedKeys.filter((k) => byKey.has(k) && !forcedOut.has(k))
    );
    for (const k of forcedIn) frozen.add(k);
    return {
      inSet: frozen,
      blocked: false,
      badLengths: [],
      seconds: secsOf(frozen),
      locked: true,
    };
  }

  // Forced-in songs are placed before anything else, so they can never be the
  // ones squeezed out by the limit.
  for (const k of forcedIn) take(scoredBy.get(k));
  for (const s of scored) if (s.isLocked && !s.isPick) take(s);

  // Each pick-ONE group contributes exactly one song: the most X'd, and with
  // no X marks yet, its best scorer — so the set is never short a slot.
  const groups = {};
  for (const s of scored) if (s.isPick) (groups[s.artist] ||= []).push(s);
  for (const list of Object.values(groups)) {
    const best = [...list].sort((a, b) => b.xs - a.xs || b.score - a.score)[0];
    if (best) take(best);
  }

  const pool = scored
    .filter((s) => !s.isLocked && !inSet.has(s.k) && !forcedOut.has(s.k))
    .sort((a, b) => b.score - a.score || b.musts - a.musts || b.energy - a.energy);

  // A length of 0 would switch the 90-minute cap off and let everything in, so
  // refuse to call anything "in the set" rather than answer wrongly. A song
  // count doesn't depend on the clock, so it is not at risk and does not block.
  const badLengths = pool.filter((s) => !s.secs).map((s) => s.k);
  if (badLengths.length && !maxSongs) {
    return { inSet: new Set(), blocked: true, badLengths, seconds: 0 };
  }

  const aKey = (s) => String(s.artist || "").trim().toLowerCase();
  const perArtist = {};
  for (const s of chosen) perArtist[aKey(s)] = (perArtist[aKey(s)] || 0) + 1;
  const dur = () => chosen.reduce((a, s) => a + s.secs + GAP, 0);

  const full = () =>
    maxSongs ? chosen.length >= maxSongs : false;

  for (const s of pool) {
    if (full()) break;
    if (s.score < 0) continue;                                  // voted down
    const k = aKey(s);
    if (maxPerArtist && (perArtist[k] || 0) >= maxPerArtist) continue;
    // A song count ignores the clock on purpose: the runtime it lands on is
    // reported on the page rather than enforced here.
    if (!maxSongs && dur() + s.secs + GAP > TARGET) continue;   // no room left
    take(s);
    perArtist[k] = (perArtist[k] || 0) + 1;
  }

  return { inSet, blocked: false, badLengths, seconds: dur(), locked: false };
}
