import { WEIGHTS, LEARN_VALUES, songKey, runningOrder } from "../setlist.js";
import { selectSet } from "./_selection.js";

/**
 * The wire shape every page speaks: one row per song with a votes map and a
 * learn map keyed by person's name. The sheet stores those as one JSON blob
 * per person instead — keyed by the stable song key — so this is where the
 * two representations meet.
 *
 * Every field October's pages read is unchanged. New fields are only ever
 * added alongside, never renamed.
 */
export function buildPayload(state) {
  const {
    songs, voters, learners, availability = {}, tunings, settings = {},
    tempos = {}, lyricKeys = new Set(), library = {}, show = {},
  } = state;
  const roster = rosterOf(settings);
  const band = (settings.band || []).filter((n) => roster.includes(n));

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
    // October's rows are frozen until its gig: it never borrows library facts,
    // so songs it shares with a later show cannot move its running order.
    const lib = (show.id && show.id !== "oct" && library[s.k]) || {};
    const tempo = tempos[s.k] || {};
    // A show's own row wins; where it leaves a fact blank, the library's
    // answer fills it. Energy and tags travel together, by the curated rule:
    // a row with an Energy value uses its own tags exactly, blank included.
    const curated = Number(s.energy) > 0;
    const energy = curated ? s.energy : lib.energy || 0;
    const cleared = (s.tags || []).some((t) => /^(-|none)$/i.test(t));
    const tags = curated || cleared || !(lib.energy > 0) ? s.tags : lib.tags;
    const bpm = tempo.bpm || lib.bpm || 0;
    return {
      k: s.k,
      section: s.section,
      song: s.song,
      artist: s.artist,
      lead: s.lead || lib.lead || "",
      len: s.len || lib.len || "",
      energy,
      tags,
      order: s.order,
      force: s.force || "",
      keyboard: s.keyboard || lib.keyboard || "",
      tuning: tunings[s.k] || "",
      votes,
      learn,
      year: s.year || lib.year || "",
      era: s.era || lib.era || "",
      bpm,
      beats: tempo.beats || 4,
      // "set": saved on the Tempos tab. "est": only the library's estimate.
      bpmSource: tempo.bpm ? "set" : bpm ? "est" : "none",
      hasLyrics: lyricKeys.has(s.k),
    };
  });

  // Which songs are actually in the set, worked out here so every page agrees
  // on it rather than each deciding for itself.
  const sel = selectSet(rows, roster, { settings });
  for (const r of rows) {
    r.inSet = sel.inSet.has(r.k);
    r.cut = r.inSet ? null : (sel.cut && sel.cut[r.k]) || null;
  }
  const inSetRows = rows.filter((r) => r.inSet);
  const ordered = sel.blocked
    ? { order: [], mode: "auto" }
    : runningOrder(inSetRows, {
      engine: settings.orderEngine === "curve" ? "curve" : "pacing",
      roster,
      weights: WEIGHTS,
    });

  return {
    voters: roster,
    // Only the band practises. People who only vote stop at the ballot.
    learners: band,
    band,
    learnValues: LEARN_VALUES,
    weights: WEIGHTS,
    limits: { maxPerArtist: Number(settings.maxPerArtist ?? 2) },
    // Who can make which day, keyed by plain "YYYY-MM-DD". Only the band: the
    // calendar is for getting the players in a room.
    availability: Object.fromEntries(
      band.map((n) => [n, (availability[n] && availability[n].days) || {}])
    ),
    gigDate: settings.gigDate || "",
    set: {
      count: sel.inSet.size,
      seconds: sel.seconds,
      // Frozen: votes no longer move this list.
      locked: !!sel.locked,
      // 0 means the time budget decides where the set gets cut.
      maxSongs: Number(settings.maxSongs) || 0,
      // True when a length in the sheet is unreadable: the time budget cannot
      // bind, so no song can honestly be called in or out.
      blocked: sel.blocked,
      badLengths: sel.badLengths,
      order: ordered.order,
      orderMode: ordered.mode,
    },
    show: {
      id: show.id || "oct",
      name: settings.showName || show.name || "",
      occasion: settings.occasion || "",
      bandName: settings.bandName || "",
      owner: settings.owner || "",
      gigDate: settings.gigDate || show.gigDate || "",
      status: show.status || "current",
      requireBandCode: !!show.requireBandCode,
    },
    settings: {
      budgetSeconds: Number(settings.budgetSeconds) || 0,
      gapSeconds: Number(settings.gapSeconds) || 0,
      maxSongs: Number(settings.maxSongs) || 0,
      maxPerArtist: Number(settings.maxPerArtist) || 0,
      warnings: settings.warnings || [],
      leads: settings.leads || [],
      eras: settings.eras || [],
      orderEngine: settings.orderEngine === "curve" ? "curve" : "pacing",
    },
    rows,
  };
}

/**
 * Exactly the people on the show's voter list, in that order.
 *
 * The Votes tab is deliberately NOT consulted for who counts. Someone who
 * leaves the band keeps their row — nothing is deleted — but their ballot
 * stops shaping the set the moment their name comes off the list, and goes
 * back to counting if it is ever put back.
 */
export function rosterOf(settings = {}) {
  return [...(settings.voters || [])];
}

/** The name as the list spells it, or null when it is not on the list. */
export function onList(list, raw) {
  const want = String(raw || "").trim().toLowerCase();
  if (!want) return null;
  return (list || []).find((n) => n.toLowerCase() === want) || null;
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

/** Every endpoint answers the methods it lists and nothing else. */
export function methodGuard(req, res, method) {
  const allowed = Array.isArray(method) ? method : [method];
  if (allowed.includes(req.method)) return false;
  res.setHeader("Allow", allowed.join(", "));
  fail(res, 405, `Use ${allowed.join(" or ")}.`);
  return true;
}

/** Run a handler body, mapping thrown { status } errors onto the envelope. */
export async function guarded(res, fn) {
  try {
    return await fn();
  } catch (e) {
    return fail(res, e.status || 500, e.message);
  }
}

/** The `show` a request names: query string on GET, body on POST. */
export function showParam(req, body) {
  return (req.query && req.query.show) || (body && body.show) || "";
}
