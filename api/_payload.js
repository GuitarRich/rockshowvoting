import { WEIGHTS, MAX_PER_ARTIST, VOTERS, LEARN_VALUES, songKey } from "../setlist.js";

/**
 * The wire shape every page speaks: one row per song with a votes map and a
 * learn map keyed by person's name. The sheet stores those as one JSON blob
 * per person instead — keyed by the stable song key — so this is where the
 * two representations meet. Kept byte-identical to what the Apps Script
 * backend served, so the pages did not have to be rewritten to move here.
 */
export function buildPayload(state) {
  const { songs, voters, learners, tunings } = state;
  const roster = rosterOf(voters, learners);

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
      tuning: tunings[s.k] || "",
      votes,
      learn,
    };
  });

  return {
    voters: roster,
    learners: roster,
    learnValues: LEARN_VALUES,
    weights: WEIGHTS,
    limits: { maxPerArtist: MAX_PER_ARTIST },
    rows,
  };
}

/**
 * The band, plus anyone the sheet has data for who is not on the list. A name
 * that was renamed in setlist.js must not make its existing votes vanish.
 */
export function rosterOf(voters = {}, learners = {}) {
  const seen = new Set(VOTERS);
  const out = [...VOTERS];
  for (const name of [...Object.keys(voters), ...Object.keys(learners)]) {
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
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
