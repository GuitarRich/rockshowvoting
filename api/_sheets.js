import { google } from "googleapis";
import {
  voteWeight,
  songKey,
  isVoteValue,
  isLearnValue,
  VOTERS,
  BAND,
  MAX_PER_ARTIST,
  keyboardValue,
  TUNING_SEEDS,
  normBpm,
  normBeats,
} from "../setlist.js";

// ---------------------------------------------------------------------------
// One sheet, many shows.
//
// Every show owns a handful of tabs, named with the show's prefix: November's
// votes live on `nov·Votes`. October was here first and its prefix is empty,
// so its tabs keep the names they have always had and nothing about the live
// October app moves. The `Shows` tab is the registry of which shows exist.
//
// Song content that is the same whatever the show — lyrics, tempos, tunings,
// the song facts in `Library` — lives on unprefixed library tabs, so a song
// that comes back for a later show brings its words and tempo with it.
// ---------------------------------------------------------------------------

const SHOWS_TAB = "Shows";
const SONGS_TAB = "Songs";
const VOTES_TAB = "Votes";
const GRID_TAB = "Grid";
const LEARN_TAB = "Learning";
const SETTINGS_TAB = "Settings";
const AVAIL_TAB = "Availability";
const TUNINGS_TAB = "Tunings";
const LYRICS_TAB = "Lyrics";
const TEMPOS_TAB = "Tempos";
const LIBRARY_TAB = "Library";

const SHOW_HEADERS = ["Id", "Prefix", "Name", "GigDate", "Status", "RequireBandCode"];
const SONG_HEADERS = [
  "Key", "Section", "Song", "Artist", "Lead", "Length", "Energy", "Tags", "Order",
  // IN forces a song into the set whatever it scored, OUT keeps it out
  // whatever it scored. Blank leaves it to the vote.
  "Force",
  // ESSENTIAL / ADDS / NONE. Blank means nobody has judged it yet.
  "Keyboard",
  // Added after October went live, to the right so nothing else moves.
  "Year", "Era",
];
const VOTE_HEADERS = ["Name", "UpdatedAt", "AppVersion", "VoteCount", "VotesJSON"];
const TUNING_HEADERS = ["Key", "Song", "Artist", "Tuning"];
// Same row-per-person shape as the Votes tab, but its own tab: two people can
// then save a vote and a practice status at the same moment without either
// write clobbering the other's row.
const LEARN_HEADERS = ["Name", "UpdatedAt", "AppVersion", "KnownCount", "LearnJSON"];
const SETTINGS_HEADERS = ["Key", "Value"];
const AVAIL_HEADERS = ["Name", "UpdatedAt", "AppVersion", "DaysFree", "DaysJSON"];
const LYRICS_HEADERS = ["Key", "Song", "Artist", "Lyrics"];
const TEMPO_HEADERS = ["Key", "Song", "Artist", "BPM", "BeatsPerBar"];
const LIBRARY_HEADERS = [
  "Key", "Song", "Artist", "Length", "Year", "Era", "Bpm", "Energy", "Tags", "Lead", "Keyboard",
];

export const MAX_LYRICS = 20000;

/** The show every request without a `show` gets: October, on its own tabs. */
export const OCT = Object.freeze({
  id: "oct",
  prefix: "",
  name: "October Anniversary Show",
  gigDate: "",
  status: "current",
  requireBandCode: false,
});

// Defaults for a show that has never had a setting written. October's are its
// behaviour before settings existed, so a missing key changes nothing.
export const SETTINGS_DEFAULTS = Object.freeze({
  maxSongs: 0,
  locked: false,
  lockedKeys: [],
  gigDate: "",
  showName: "",
  occasion: "",
  bandName: "",
  voters: VOTERS,
  band: BAND,
  owner: "Rich",
  budgetSeconds: 90 * 60,
  gapSeconds: 25,
  maxPerArtist: MAX_PER_ARTIST,
  // How ties on score and MUSTs are broken: "energy" (October) or "shorter"
  // (Band Vote's rule, kept so November's set comes out the same).
  tieBreak: "energy",
  // Which running-order engine: "pacing" (October) or "curve" (Band Vote).
  orderEngine: "pacing",
  warnings: ["waiting", "vocalBalance", "flatStretch", "leadRun", "dedication", "cuts"],
  leads: ["V1", "V2", "DUET"],
  eras: [],
});

const JSON_SETTINGS = ["lockedKeys", "voters", "band", "warnings", "leads", "eras"];
const NUMBER_SETTINGS = ["maxSongs", "budgetSeconds", "gapSeconds", "maxPerArtist"];
const STRING_SETTINGS = ["showName", "occasion", "bandName", "owner", "tieBreak", "orderEngine"];
export const SETTING_KEYS = [
  "locked", "gigDate", ...JSON_SETTINGS, ...NUMBER_SETTINGS, ...STRING_SETTINGS,
];

let cached = null;

/**
 * Test seam. The endpoints are otherwise impossible to exercise without live
 * Google credentials, and this system's whole history is bugs that only show
 * up against a real read/write cycle.
 */
export function setSheetsClient(client) {
  cached = client;
}

export function sheetsClient() {
  if (cached) return cached;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY");
  }
  // Vercel env vars usually arrive with literal \n rather than real newlines.
  key = key.replace(/\\n/g, "\n").trim();
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  cached = google.sheets({ version: "v4", auth });
  return cached;
}

export const sheetId = () => {
  const id = process.env.SHEET_ID;
  if (!id) throw new Error("Missing SHEET_ID");
  return id;
};

/** A tab name ready for an A1 range — quoted, because prefixes carry a `·`. */
const q = (title) => `'${String(title).replace(/'/g, "''")}'`;
/** The actual tab name for one of a show's tabs. */
export const tabName = (show, name) => ((show && show.prefix) || "") + name;
const T = (show, name) => q(tabName(show, name));
const L = (name) => q(name);

const colLetter = (n) => String.fromCharCode(64 + n); // 1 → A, fine up to Z

// ---------------------------------------------------------------------------
// Shows registry
// ---------------------------------------------------------------------------

const truthy = (v) => /^(true|yes|1)$/i.test(String(v || "").trim());

function parseShowRow(r) {
  const id = String(r[0] || "").trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  return {
    id,
    prefix: String(r[1] || ""),
    name: String(r[2] || "").trim() || id,
    gigDate: /^\d{4}-\d{2}-\d{2}$/.test(String(r[3] || "").trim()) ? String(r[3]).trim() : "",
    status: String(r[4] || "").trim().toLowerCase() === "past" ? "past" : "current",
    requireBandCode: truthy(r[5]),
  };
}

/**
 * Every show, creating the registry on first sight. The first run seeds
 * October's row, so an older deploy's sheet gains the tab without anyone
 * having to set it up.
 */
export async function readShows() {
  const sheets = sheetsClient();
  const id = sheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const have = new Set(meta.data.sheets.map((s) => s.properties.title));
  if (!have.has(SHOWS_TAB)) {
    let gig = "";
    if (have.has(SETTINGS_TAB)) {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `${L(SETTINGS_TAB)}!A2:B50`,
      });
      const row = (res.data.values || []).find((r) => String(r[0] || "").trim() === "gigDate");
      gig = row ? String(row[1] || "").trim() : "";
    }
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ addSheet: { properties: { title: SHOWS_TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${L(SHOWS_TAB)}!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [SHOW_HEADERS, [OCT.id, "", OCT.name, gig, "current", "FALSE"]],
      },
    });
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${L(SHOWS_TAB)}!A2:F100`,
  });
  const shows = (res.data.values || []).map(parseShowRow).filter(Boolean);
  if (!shows.some((s) => s.id === OCT.id)) shows.unshift({ ...OCT });
  return shows;
}

/** The show a request names, or October when it names none. */
export async function resolveShow(rawId) {
  const want = String(rawId || "").trim().toLowerCase() || OCT.id;
  const shows = await readShows();
  const show = shows.find((s) => s.id === want);
  if (!show) throw Object.assign(new Error(`No show called "${want}".`), { status: 404 });
  return show;
}

/**
 * The show a page opens on when the link names none: the soonest current show
 * whose gig is today or later, then the latest current one, then October.
 */
export function defaultShowId(shows, today = new Date().toISOString().slice(0, 10)) {
  const current = shows.filter((s) => s.status !== "past");
  const upcoming = current
    .filter((s) => s.gigDate && s.gigDate >= today)
    .sort((a, b) => (a.gigDate < b.gigDate ? -1 : 1));
  if (upcoming.length) return upcoming[0].id;
  const dated = current.filter((s) => s.gigDate).sort((a, b) => (a.gigDate < b.gigDate ? 1 : -1));
  if (dated.length) return dated[0].id;
  return current.length ? current[0].id : OCT.id;
}

/** Add one show to the registry. The caller has checked the id is free. */
export async function appendShow(show) {
  const sheets = sheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${L(SHOWS_TAB)}!A2:F2`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        show.id, show.prefix, show.name, show.gigDate || "",
        show.status || "current", show.requireBandCode ? "TRUE" : "FALSE",
      ]],
    },
  });
}

/** Change fields on one registry row, found by id. */
export async function updateShow(idToChange, patch) {
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${L(SHOWS_TAB)}!A2:F100`,
  });
  const rows = res.data.values || [];
  const i = rows.findIndex((r) => String(r[0] || "").trim().toLowerCase() === idToChange);
  if (i < 0) throw Object.assign(new Error(`No show called "${idToChange}".`), { status: 404 });
  const cur = parseShowRow(rows[i]);
  const next = { ...cur, ...patch };
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${L(SHOWS_TAB)}!A${i + 2}:F${i + 2}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        next.id, next.prefix, next.name, next.gigDate || "", next.status,
        next.requireBandCode ? "TRUE" : "FALSE",
      ]],
    },
  });
  return next;
}

// ---------------------------------------------------------------------------
// Tabs and headers
// ---------------------------------------------------------------------------

function tabSpecs(show) {
  return [
    [tabName(show, SONGS_TAB), SONG_HEADERS],
    [tabName(show, VOTES_TAB), VOTE_HEADERS],
    [tabName(show, GRID_TAB), null],
    [tabName(show, LEARN_TAB), LEARN_HEADERS],
    [tabName(show, SETTINGS_TAB), SETTINGS_HEADERS],
    [tabName(show, AVAIL_TAB), AVAIL_HEADERS],
    [TUNINGS_TAB, TUNING_HEADERS],
    [LYRICS_TAB, LYRICS_HEADERS],
    [TEMPOS_TAB, TEMPO_HEADERS],
    [LIBRARY_TAB, LIBRARY_HEADERS],
  ];
}

/**
 * Create any tab that doesn't exist yet and write its header row. Called at
 * the top of every read and write, so a blank sheet self-provisions on the
 * first request and there is no separate setup script to run.
 */
export async function ensureTabs(show = OCT) {
  const sheets = sheetsClient();
  const id = sheetId();
  const specs = tabSpecs(show);
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const have = new Set(meta.data.sheets.map((s) => s.properties.title));
  const missing = specs.map(([t]) => t).filter((t) => !have.has(t));

  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  }
  // Headers are rewritten whenever they drift, on every tab, not just new
  // ones. A header row that is merely shorter gains the new columns on the
  // right; every column it already had keeps its name and position.
  const withHeaders = specs.filter(([, h]) => h);
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: id,
    ranges: withHeaders.map(([t, h]) => `${q(t)}!A1:${colLetter(h.length)}1`),
  });
  const data = [];
  withHeaders.forEach(([t, h], i) => {
    const got = (res.data.valueRanges[i].values || [])[0] || [];
    if (!h.every((x, j) => got[j] === x)) {
      data.push({ range: `${q(t)}!A1:${colLetter(h.length)}1`, values: [h] });
    }
  });
  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: id,
      requestBody: { valueInputOption: "RAW", data },
    });
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const parseJson = (raw, fallback) => {
  try {
    const v = JSON.parse(raw || "");
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
};

function parsePeople(rows, field) {
  const out = {};
  for (const r of rows) {
    const [name, updatedAt, , , json] = r;
    if (!name) continue;
    out[name] = { [field]: parseJson(json || "{}", {}), ts: Number(updatedAt) || 0 };
  }
  return out;
}

export function parseSongRow(r) {
  return {
    k: String(r[0] || "").trim() || songKey(r[2], r[3]),
    section: String(r[1] || "").trim(),
    song: String(r[2] || "").trim(),
    artist: String(r[3] || "").trim(),
    lead: String(r[4] || "").trim().toUpperCase(),
    len: String(r[5] || "").trim(),
    energy: Number(String(r[6] || "").trim()) || 0,
    tags: String(r[7] || "")
      .split(/[,;]\s*/)
      .filter(Boolean),
    order: Number(String(r[8] || "").trim()) || 0,
    force: forceValue(r[9]),
    keyboard: keyboardValue(r[10]),
    year: String(r[11] || "").trim(),
    era: String(r[12] || "").trim(),
  };
}

export function parseLibraryRows(rows) {
  const out = {};
  for (const r of rows) {
    const k = String(r[0] || "").trim() || (r[1] ? songKey(r[1], r[2]) : "");
    if (!k) continue;
    out[k] = {
      k,
      song: String(r[1] || "").trim(),
      artist: String(r[2] || "").trim(),
      len: String(r[3] || "").trim(),
      year: String(r[4] || "").trim(),
      era: String(r[5] || "").trim(),
      bpm: normBpm(r[6]),
      energy: Number(String(r[7] || "").trim()) || 0,
      tags: String(r[8] || "").split(/[,;]\s*/).filter(Boolean),
      lead: String(r[9] || "").trim().toUpperCase(),
      keyboard: keyboardValue(r[10]),
    };
  }
  return out;
}

export async function readAll(show = OCT) {
  await ensureTabs(show);
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: id,
    ranges: [
      `${T(show, SONGS_TAB)}!A2:M500`,
      `${T(show, VOTES_TAB)}!A2:E200`,
      `${L(TUNINGS_TAB)}!A2:D1000`,
      `${T(show, LEARN_TAB)}!A2:E200`,
      `${T(show, SETTINGS_TAB)}!A2:B50`,
      `${T(show, AVAIL_TAB)}!A2:E200`,
      `${L(LYRICS_TAB)}!A2:A1000`,
      `${L(TEMPOS_TAB)}!A2:E1000`,
      `${L(LIBRARY_TAB)}!A2:K1000`,
    ],
  });
  const [
    songRows = [], voteRows = [], tuningRows = [], learnRows = [], settingRows = [], availRows = [],
    lyricKeyRows = [], tempoRows = [], libraryRows = [],
  ] = res.data.valueRanges.map((r) => r.values || []);

  const songs = songRows.filter((r) => r[2] && r[3]).map(parseSongRow);

  // A row's presence makes it authoritative, even with a blank tuning cell:
  // a cleared cell means "E standard", not "fall back to the seed".
  const tunings = {};
  for (const r of tuningRows) {
    const key = String(r[0] || "").trim() || (r[1] ? songKey(r[1], r[2]) : "");
    if (!key) continue;
    tunings[key] = String(r[3] || "").replace(/[<>&]/g, "").trim();
  }

  const seeded = await syncTunings(
    [
      ...TUNING_SEEDS,
      ...songs.map((s) => ({ name: s.song, artist: s.artist, tuning: "" })),
    ],
    tunings
  );

  const tempos = {};
  for (const r of tempoRows) {
    const key = String(r[0] || "").trim() || (r[1] ? songKey(r[1], r[2]) : "");
    if (!key) continue;
    tempos[key] = { bpm: normBpm(r[3]), beats: normBeats(r[4]) };
  }

  const settings = parseSettings(settingRows);
  return {
    show: { ...show, gigDate: settings.gigDate || show.gigDate },
    songs,
    voters: parsePeople(voteRows, "votes"),
    learners: parsePeople(learnRows, "learn"),
    availability: parsePeople(availRows, "days"),
    settings,
    tunings: seeded,
    tempos,
    lyricKeys: new Set(lyricKeyRows.map((r) => String(r[0] || "").trim()).filter(Boolean)),
    library: parseLibraryRows(libraryRows),
  };
}

/**
 * Append rows to the Tunings tab for any song it doesn't know yet. Existing
 * rows are never touched — the sheet stays the source of truth for edits.
 */
export async function syncTunings(entries, existing) {
  const sheets = sheetsClient();
  const id = sheetId();
  const have = existing || {};
  const fresh = [];
  const seen = new Set(Object.keys(have));
  for (const e of entries) {
    const key = e.k || songKey(e.name, e.artist);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push([key, e.name, e.artist || "", e.tuning || ""]);
  }
  if (fresh.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: `${L(TUNINGS_TAB)}!A2:D2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: fresh },
    });
  }
  const out = { ...have };
  fresh.forEach((r) => {
    out[r[0]] = r[3];
  });
  return out;
}

/** Only IN, OUT or nothing. Anything else in the cell is treated as nothing. */
export function forceValue(raw) {
  const v = String(raw || "").trim().toUpperCase();
  return v === "IN" || v === "OUT" ? v : "";
}

/**
 * The Settings tab is a plain key/value list so it stays readable and
 * hand-editable — the whole point of keeping this on a sheet. A key that is
 * missing, or holds something unreadable, falls back to its default.
 */
export function parseSettings(rows) {
  const out = {};
  for (const [k, v] of Object.entries(SETTINGS_DEFAULTS)) {
    out[k] = Array.isArray(v) ? [...v] : v;
  }
  for (const r of rows) {
    const key = String(r[0] || "").trim();
    const raw = String(r[1] ?? "").trim();
    if (key === "locked") out.locked = truthy(raw);
    else if (key === "gigDate") out.gigDate = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
    else if (key === "maxSongs") out.maxSongs = Math.max(0, Number(raw) || 0);
    else if (NUMBER_SETTINGS.includes(key)) {
      if (raw !== "" && Number.isFinite(Number(raw)) && Number(raw) >= 0) out[key] = Number(raw);
    } else if (STRING_SETTINGS.includes(key)) {
      if (raw !== "") out[key] = raw;
    } else if (JSON_SETTINGS.includes(key)) {
      const parsed = parseJson(raw, null);
      if (Array.isArray(parsed)) out[key] = parsed.map((x) => String(x).trim()).filter(Boolean);
      else if (key === "lockedKeys") out.lockedKeys = [];
    }
  }
  return out;
}

/** Write only the settings named; anything else on the tab is left alone. */
export async function writeSettings(show, patch) {
  const keys = Object.keys(patch || {});
  if (!keys.length) return;
  await ensureTabs(show);
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${T(show, SETTINGS_TAB)}!A2:A50`,
  });
  const have = (res.data.values || []).map((r) => String(r[0] || "").trim());
  const updates = [];
  const appends = [];
  for (const key of keys) {
    const value =
      typeof patch[key] === "object" ? JSON.stringify(patch[key]) : String(patch[key]);
    const i = have.indexOf(key);
    if (i >= 0) updates.push({ range: `${T(show, SETTINGS_TAB)}!A${i + 2}:B${i + 2}`, values: [[key, value]] });
    else {
      appends.push([key, value]);
      have.push(key);
    }
  }
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: id,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
  }
  if (appends.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: `${T(show, SETTINGS_TAB)}!A2:B2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: appends },
    });
  }
}

// ---------------------------------------------------------------------------
// Per-person rows
// ---------------------------------------------------------------------------

/**
 * Upsert one person's row on a name-keyed tab (case-insensitive on the name).
 * Never rewrites the whole range — concurrent submissions from phones would
 * interleave and lose someone's save.
 */
async function upsertByName(tabRef, name, row) {
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${tabRef}!A2:A200`,
  });
  const names = (res.data.values || []).map((r) => (r[0] || "").toLowerCase());
  const idx = names.indexOf(String(name).toLowerCase());

  if (idx >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${tabRef}!A${idx + 2}:E${idx + 2}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: `${tabRef}!A2:E2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  }
}

export async function writeVoter(show, { name, votes, ts, version }) {
  await ensureTabs(show);
  await upsertByName(T(show, VOTES_TAB), name, [
    name,
    String(ts),
    version || "",
    Object.keys(votes).length,
    JSON.stringify(votes),
  ]);
}

/** Which days one person can make. Separate tab, same row-per-person shape. */
export async function writeAvailability(show, { name, days, ts, version }) {
  await ensureTabs(show);
  const free = Object.values(days).filter((v) => v === "YES").length;
  await upsertByName(T(show, AVAIL_TAB), name, [
    name,
    String(ts),
    version || "",
    free,
    JSON.stringify(days),
  ]);
}

/** Same, for "how well do I know it". Separate tab, separate blob. */
export async function writeLearner(show, { name, learn, ts, version }) {
  await ensureTabs(show);
  const known = Object.values(learn).filter((v) => v === "KNOW").length;
  await upsertByName(T(show, LEARN_TAB), name, [
    name,
    String(ts),
    version || "",
    known,
    JSON.stringify(learn),
  ]);
}

// ---------------------------------------------------------------------------
// Library tabs — shared by every show, written one row at a time
// ---------------------------------------------------------------------------

/**
 * Set the tuning on rows the admin edited. Only the named keys are touched —
 * everything else in the tab, including a deliberately blank cell, is left
 * exactly as the sheet has it.
 */
export async function writeTunings(map) {
  const keys = Object.keys(map || {});
  if (!keys.length) return;
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${L(TUNINGS_TAB)}!A2:A1000`,
  });
  const rows = (res.data.values || []).map((r) => String(r[0] || "").trim());
  const data = [];
  for (const k of keys) {
    const i = rows.indexOf(k);
    if (i < 0) continue;                       // syncTunings creates it on the next read
    data.push({ range: `${L(TUNINGS_TAB)}!D${i + 2}`, values: [[map[k]]] });
  }
  if (!data.length) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: { valueInputOption: "RAW", data },
  });
}

/** Upsert one keyed row on a library tab. Only that row is written. */
async function upsertByKey(tab, width, row) {
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${L(tab)}!A2:A1000`,
  });
  const keys = (res.data.values || []).map((r) => String(r[0] || "").trim());
  const i = keys.indexOf(row[0]);
  const last = colLetter(width);
  if (i >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${L(tab)}!A${i + 2}:${last}${i + 2}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: `${L(tab)}!A2:${last}2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  }
}

/** The words for some songs (all of them when `keys` is omitted). */
export async function readLyrics(keys) {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${L(LYRICS_TAB)}!A2:D1000`,
  });
  const want = keys ? new Set(keys) : null;
  const out = {};
  for (const r of res.data.values || []) {
    const k = String(r[0] || "").trim() || (r[1] ? songKey(r[1], r[2]) : "");
    if (!k || (want && !want.has(k))) continue;
    out[k] = String(r[3] || "");
  }
  return out;
}

export async function writeLyric({ key, song, artist, lyrics }) {
  const text = String(lyrics ?? "").replace(/\r\n?/g, "\n");
  if (text.length > MAX_LYRICS) {
    throw Object.assign(new Error(`Lyrics are limited to ${MAX_LYRICS} characters.`), { status: 400 });
  }
  await upsertByKey(LYRICS_TAB, 4, [key, song || "", artist || "", text]);
}

/** A blank row per song that has none, so words can be pasted into the sheet. */
export async function addBlankLyricRows(songs) {
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${L(LYRICS_TAB)}!A2:A1000`,
  });
  const have = new Set((res.data.values || []).map((r) => String(r[0] || "").trim()));
  const fresh = songs.filter((s) => !have.has(s.k)).map((s) => [s.k, s.song, s.artist, ""]);
  if (fresh.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: `${L(LYRICS_TAB)}!A2:D2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: fresh },
    });
  }
  return fresh.length;
}

export async function writeTempo({ key, song, artist, bpm, beats }) {
  await upsertByKey(TEMPOS_TAB, 5, [key, song || "", artist || "", normBpm(bpm) || "", normBeats(beats)]);
}

export async function readLibrary() {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${L(LIBRARY_TAB)}!A2:K1000`,
  });
  return parseLibraryRows(res.data.values || []);
}

export function libraryRow(s) {
  return [
    s.k, s.song || "", s.artist || "", s.len || "", s.year || "", s.era || "",
    s.bpm ? String(s.bpm) : "", Number(s.energy) > 0 ? String(s.energy) : "",
    Array.isArray(s.tags) ? s.tags.join(",") : String(s.tags || ""),
    String(s.lead || "").toUpperCase(), keyboardValue(s.keyboard),
  ];
}

/**
 * Bring the Library up to date with these songs. Rows it already has are
 * updated in place, new ones appended, and nothing else is touched.
 */
export async function upsertLibrary(songs) {
  if (!songs || !songs.length) return;
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${L(LIBRARY_TAB)}!A2:A1000`,
  });
  const keys = (res.data.values || []).map((r) => String(r[0] || "").trim());
  const data = [];
  const appends = [];
  for (const s of songs) {
    const row = libraryRow(s);
    const i = keys.indexOf(s.k);
    if (i >= 0) data.push({ range: `${L(LIBRARY_TAB)}!A${i + 2}:K${i + 2}`, values: [row] });
    else {
      appends.push(row);
      keys.push(s.k);
    }
  }
  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: id,
      requestBody: { valueInputOption: "RAW", data },
    });
  }
  if (appends.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: `${L(LIBRARY_TAB)}!A2:K2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: appends },
    });
  }
}

// ---------------------------------------------------------------------------
// Whole-tab writes — admin only, enforced by the caller
// ---------------------------------------------------------------------------

export function songRow(s) {
  return [
    s.k || songKey(s.song, s.artist),
    s.section || "",
    s.song,
    s.artist,
    // A blank lead is kept blank: not every band splits songs by singer.
    String(s.lead ?? "V1").toUpperCase(),
    s.len || "3:30",
    Number(s.energy) > 0 ? Number(s.energy) : "",
    Array.isArray(s.tags) ? s.tags.join(",") : String(s.tags || ""),
    Number(s.order) > 0 ? Number(s.order) : "",
    forceValue(s.force),
    keyboardValue(s.keyboard),
    s.year || "",
    s.era || "",
  ];
}

/** Replace the whole Songs tab of one show. */
export async function writeSongs(show, songs) {
  await ensureTabs(show);
  const sheets = sheetsClient();
  const id = sheetId();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `${T(show, SONGS_TAB)}!A2:M500`,
  });
  if (!songs.length) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${T(show, SONGS_TAB)}!A2`,
    valueInputOption: "RAW",
    requestBody: { values: songs.map(songRow) },
  });
}

/**
 * Human-readable matrix: one row per song, one column per voter. Derived and
 * disposable — cleared and rewritten on each save, and the caller wraps this
 * in try/catch so a formatting failure never fails the actual vote.
 */
export async function writeGrid(show, state) {
  const { songs, voters, tunings = {}, learners = {}, settings = {} } = state;
  await ensureTabs(show);
  const sheets = sheetsClient();
  const id = sheetId();
  // Columns follow the current lists, so someone who has left the band stops
  // appearing here even though their row is still on the Votes tab.
  const who = (settings.voters || VOTERS).filter(
    (n) => voters[n] && Object.keys(voters[n].votes || {}).length
  );
  const knows = (settings.band || BAND).filter(
    (n) => learners[n] && Object.keys(learners[n].learn || {}).length
  );
  const header = [
    "Song", "Artist", "Lead", "Length", "Tuning", ...who, "SCORE", "MUSTs", "Votes cast",
    ...knows.map((n) => `${n} knows`), "Know count",
  ];
  const rows = songs.map((s) => {
    const cells = who.map((n) => {
      const v = voters[n].votes[s.k];
      return isVoteValue(v) ? String(v).toUpperCase() : "";
    });
    const learnCells = knows.map((n) => {
      const v = learners[n].learn[s.k];
      return isLearnValue(v) ? String(v).toUpperCase() : "";
    });
    const cast = cells.filter((c) => c !== "");
    return [
      s.song,
      s.artist,
      s.lead,
      s.len,
      tunings[s.k] || "",
      ...cells,
      cast.reduce((a, c) => a + voteWeight(c), 0),
      cells.filter((c) => c === "MUST").length,
      cast.length,
      ...learnCells,
      learnCells.filter((c) => c === "KNOW").length,
    ];
  });
  await sheets.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `${T(show, GRID_TAB)}!A1:AZ600`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${T(show, GRID_TAB)}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [header, ...rows] },
  });
}

/** Write a show's tabs wholesale from prepared rows (migration and new shows). */
export async function writeTabRows(show, name, rows, width) {
  await ensureTabs(show);
  const sheets = sheetsClient();
  const id = sheetId();
  const last = colLetter(width);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `${T(show, name)}!A2:${last}1000`,
  });
  if (!rows.length) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${T(show, name)}!A2`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

export const TABS = Object.freeze({
  SHOWS_TAB, SONGS_TAB, VOTES_TAB, GRID_TAB, LEARN_TAB, SETTINGS_TAB, AVAIL_TAB,
  TUNINGS_TAB, LYRICS_TAB, TEMPOS_TAB, LIBRARY_TAB,
});
export const HEADERS = Object.freeze({
  SHOW_HEADERS, SONG_HEADERS, VOTE_HEADERS, TUNING_HEADERS, LEARN_HEADERS, SETTINGS_HEADERS,
  AVAIL_HEADERS, LYRICS_HEADERS, TEMPO_HEADERS, LIBRARY_HEADERS,
});

export function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
