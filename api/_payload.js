import { WEIGHTS, MAX_PER_ARTIST, VOTERS, BAND, LEARN_VALUES, songKey } from "../setlist.js";
import { selectSet } from "./_selection.js";

/**
 * The wire shape every page speaks: one row per song with a votes map and a
 * learn map keyed by person's name. The sheet stores those as one JSON blob
 * per person instead — keyed by the stable song key — so this is where the
 * two representations meet. Kept byte-identical to what the Apps Script
 * backend served, so the pages did not have to be rewritten to move here.
 */
export function buildPayload(state) {
  const { songs, voters, learners, availability = {}, tunings, settings = {} } = state;
  const roster = rosterOf();
  const band = BAND.filter((n) => roster.includes(n));

  const rows = songs.map((s) => {
    const votes = {};
    const learn = {};
    for (const name of roster) {
      votes[name] = String((voters[name] && voters[name].votes[s.k]) || "")
        .trim()
        .toUpperCase();
      learn[name] = String((learners[name] && learners[name].learn[s.k]) || "")
        .trim()
        .toUpperCase();
    }
    return {
      k: s.k,
      section: s.section,
      song: s.song,
      artist: s.artist,
      lead: s.lead,
      len: s.len,
      energy: s.energy,
      tags: s.tags,
      order: s.order,
      force: s.force || "",
      keyboard: s.keyboard || "",
      tuning: tunings[s.k] || "",
      votes,
      learn,
    };
  });

  // Which songs are actually in the set, worked out here so every page agrees
  // on it rather than each deciding for itself.
  const sel = selectSet(rows, roster, { settings });
  for (const r of rows) r.inSet = sel.inSet.has(r.k);

  return {
    voters: roster,
    // Only the band practises. Julie and the organiser vote and stop there.
    learners: band,
    band,
    learnValues: LEARN_VALUES,
    weights: WEIGHTS,
    limits: { maxPerArtist: MAX_PER_ARTIST },
    // Who can make which day, keyed by plain "YYYY-MM-DD". Only the band: the
    // calendar is for getting five people in a room.
    availability: Object.fromEntries(
      band.map((n) => [n, (availability[n] && availability[n].days) || {}])
    ),
    gigDate: settings.gigDate || "",
    set: {
      count: sel.inSet.size,
      seconds: sel.seconds,
      // Frozen: votes no longer move this list.
      locked: !!sel.locked,
      // 0 means the 90 minutes decides where the set gets cut.
      maxSongs: Number(settings.maxSongs) || 0,
      // True when a length in the sheet is unreadable: the 90-minute cap
      // cannot bind, so no song can honestly be called in or out.
      blocked: sel.blocked,
      badLengths: sel.badLengths,
    },
    rows,
  };
}

/**
 * Exactly the people listed in VOTERS, in that order.
 *
 * The sheet is deliberately NOT consulted for who counts. Someone who leaves
 * the band keeps their row on the Votes tab — nothing is deleted — but their
 * ballot stops shaping the set the moment their name comes off the list, and
 * goes back to counting if it is ever put back.
 */
export function rosterOf() {
  return [...VOTERS];
}

/**
 * Pages address songs as "Song|Artist"; the sheet addresses them by the stable
 * key. Match on the live title/artist first so a song renamed by the admin
 * keeps its votes, and fall back to the slug for anything the sheet has not
 * caught up with.
 */
export function keyResolver(songs) {
  const byPair = new Map();
  const byKey = new Map();
  for (const s of songs) {
    byPair.set(`${s.song}|${s.artist}`.toLowerCase(), s);
    byKey.set(s.k, s);
  }
  return (raw) => {
    const key = String(raw || "").trim();
    if (!key) return null;
    if (byKey.has(key)) return byKey.get(key);
    const pair = byPair.get(key.toLowerCase());
    if (pair) return pair;
    const [song, artist] = key.split("|");
    return byKey.get(songKey(song, artist)) || null;
  };
}

/** Uniform envelope, so a page never has to guess how a failure is shaped. */
export function fail(res, code, message, extra) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json({ ok: false, error: message, ...(extra || {}) });
}

export function ok(res, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, ...body });
}

/** Every endpoint answers exactly one method. */
export function methodGuard(req, res, method) {
  if (req.method === method) return false;
  res.setHeader("Allow", method);
  fail(res, 405, `Use ${method}.`);
  return true;
}
