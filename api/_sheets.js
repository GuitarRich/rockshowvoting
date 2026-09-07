import { google } from "googleapis";
import {
  voteWeight,
  songKey,
  isVoteValue,
  isLearnValue,
  VOTERS,
  BAND,
  TUNING_SEEDS,
} from "../setlist.js";

const SONGS_TAB = "Songs";
const VOTES_TAB = "Votes";
const GRID_TAB = "Grid";
const TUNINGS_TAB = "Tunings";
const LEARN_TAB = "Learning";
const SETTINGS_TAB = "Settings";

const SONG_HEADERS = [
  "Key", "Section", "Song", "Artist", "Lead", "Length", "Energy", "Tags", "Order",
  // IN forces a song into the set whatever it scored, OUT keeps it out
  // whatever it scored. Blank leaves it to the vote.
  "Force",
];
const VOTE_HEADERS = ["Name", "UpdatedAt", "AppVersion", "VoteCount", "VotesJSON"];
const TUNING_HEADERS = ["Key", "Song", "Artist", "Tuning"];
// Same row-per-person shape as the Votes tab, but its own tab: two people can
// then save a vote and a practice status at the same moment without either
// write clobbering the other's row.
const LEARN_HEADERS = ["Name", "UpdatedAt", "AppVersion", "KnownCount", "LearnJSON"];
const SETTINGS_HEADERS = ["Key", "Value"];

// Defaults for a sheet that has never had a setting written to it.
const SETTINGS_DEFAULTS = { maxSongs: 0, locked: false, lockedKeys: [] };

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

/**
 * Create any tab that doesn't exist yet and write its header row. Called at
 * the top of every read and write, so a blank sheet self-provisions on the
 * first request and there is no separate setup script to run.
 */
export async function ensureTabs() {
  const sheets = sheetsClient();
  const id = sheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const have = new Set(meta.data.sheets.map((s) => s.properties.title));
  const wanted = [SONGS_TAB, VOTES_TAB, GRID_TAB, TUNINGS_TAB, LEARN_TAB, SETTINGS_TAB];
  const missing = wanted.filter((t) => !have.has(t));

  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  }
  // Headers are rewritten whenever they drift, on every tab, not just new ones.
  await Promise.all([
    ensureHeaders(sheets, id, SONGS_TAB, "A1:J1", SONG_HEADERS),
    ensureHeaders(sheets, id, VOTES_TAB, "A1:E1", VOTE_HEADERS),
    ensureHeaders(sheets, id, TUNINGS_TAB, "A1:D1", TUNING_HEADERS),
    ensureHeaders(sheets, id, LEARN_TAB, "A1:E1", LEARN_HEADERS),
    ensureHeaders(sheets, id, SETTINGS_TAB, "A1:B1", SETTINGS_HEADERS),
  ]);
  return { SONGS_TAB, VOTES_TAB, GRID_TAB, TUNINGS_TAB, LEARN_TAB, SETTINGS_TAB };
}

async function ensureHeaders(sheets, id, tab, range, headers) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${tab}!${range}`,
  });
  const have = (res.data.values && res.data.values[0]) || [];
  if (headers.every((h, i) => have[i] === h)) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${tab}!${range}`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] },
  });
}

export async function readAll() {
  await ensureTabs();
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: id,
    ranges: [
      `${SONGS_TAB}!A2:J500`,
      `${VOTES_TAB}!A2:E200`,
      `${TUNINGS_TAB}!A2:D500`,
      `${LEARN_TAB}!A2:E200`,
      `${SETTINGS_TAB}!A2:B50`,
    ],
  });
  const [songRows = [], voteRows = [], tuningRows = [], learnRows = [], settingRows = []] =
    res.data.valueRanges.map((r) => r.values || []);

  const songs = songRows
    .filter((r) => r[2] && r[3])
    .map((r) => ({
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
    }));

  const voters = {};
  for (const r of voteRows) {
    const [name, updatedAt, , , json] = r;
    if (!name) continue;
    let votes = {};
    try {
      votes = JSON.parse(json || "{}");
    } catch {
      votes = {};
    }
    voters[name] = { votes, ts: Number(updatedAt) || 0 };
  }

  const learners = {};
  for (const r of learnRows) {
    const [name, updatedAt, , , json] = r;
    if (!name) continue;
    let learn = {};
    try {
      learn = JSON.parse(json || "{}");
    } catch {
      learn = {};
    }
    learners[name] = { learn, ts: Number(updatedAt) || 0 };
  }

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

  return { songs, voters, learners, settings: parseSettings(settingRows), tunings: seeded };
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
    const key = songKey(e.name, e.artist);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push([key, e.name, e.artist || "", e.tuning || ""]);
  }
  if (fresh.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: `${TUNINGS_TAB}!A2:D2`,
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
 * hand-editable — the whole point of keeping this on a sheet.
 */
function parseSettings(rows) {
  const out = { ...SETTINGS_DEFAULTS, lockedKeys: [] };
  for (const r of rows) {
    const key = String(r[0] || "").trim();
    const raw = String(r[1] ?? "").trim();
    if (key === "maxSongs") out.maxSongs = Math.max(0, Number(raw) || 0);
    else if (key === "locked") out.locked = /^(true|yes|1)$/i.test(raw);
    else if (key === "lockedKeys") {
      try {
        const parsed = JSON.parse(raw || "[]");
        out.lockedKeys = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        out.lockedKeys = [];
      }
    }
  }
  return out;
}

/** Write only the settings named; anything else on the tab is left alone. */
export async function writeSettings(patch) {
  const keys = Object.keys(patch || {});
  if (!keys.length) return;
  await ensureTabs();
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${SETTINGS_TAB}!A2:A50`,
  });
  const have = (res.data.values || []).map((r) => String(r[0] || "").trim());
  const updates = [];
  const appends = [];
  for (const key of keys) {
    const value =
      typeof patch[key] === "object" ? JSON.stringify(patch[key]) : String(patch[key]);
    const i = have.indexOf(key);
    if (i >= 0) updates.push({ range: `${SETTINGS_TAB}!A${i + 2}:B${i + 2}`, values: [[key, value]] });
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
      range: `${SETTINGS_TAB}!A2:B2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: appends },
    });
  }
}

/**
 * Upsert one person's row on a name-keyed tab (case-insensitive on the name).
 * Never rewrites the whole range — concurrent submissions from phones would
 * interleave and lose someone's save.
 */
async function upsertByName(tab, name, row) {
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${tab}!A2:A200`,
  });
  const names = (res.data.values || []).map((r) => (r[0] || "").toLowerCase());
  const idx = names.indexOf(String(name).toLowerCase());

  if (idx >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${tab}!A${idx + 2}:E${idx + 2}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: `${tab}!A2:E2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  }
}

export async function writeVoter({ name, votes, ts, version }) {
  await ensureTabs();
  await upsertByName(VOTES_TAB, name, [
    name,
    String(ts),
    version || "",
    Object.keys(votes).length,
    JSON.stringify(votes),
  ]);
}

/** Same, for "how well do I know it". Separate tab, separate blob. */
export async function writeLearner({ name, learn, ts, version }) {
  await ensureTabs();
  const known = Object.values(learn).filter((v) => v === "KNOW").length;
  await upsertByName(LEARN_TAB, name, [
    name,
    String(ts),
    version || "",
    known,
    JSON.stringify(learn),
  ]);
}

/**
 * Set the tuning on rows the admin edited. Only the named keys are touched —
 * everything else in the tab, including a deliberately blank cell, is left
 * exactly as the sheet has it.
 */
export async function writeTunings(map) {
  const keys = Object.keys(map || {});
  if (!keys.length) return;
  await ensureTabs();
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${TUNINGS_TAB}!A2:A500`,
  });
  const rows = (res.data.values || []).map((r) => String(r[0] || "").trim());
  const data = [];
  for (const k of keys) {
    const i = rows.indexOf(k);
    if (i < 0) continue;                       // syncTunings creates it on the next read
    data.push({ range: `${TUNINGS_TAB}!D${i + 2}`, values: [[map[k]]] });
  }
  if (!data.length) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: { valueInputOption: "RAW", data },
  });
}

/** Replace the whole Songs tab. Admin-only, enforced by the caller. */
export async function writeSongs(songs) {
  await ensureTabs();
  const sheets = sheetsClient();
  const id = sheetId();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `${SONGS_TAB}!A2:J500`,
  });
  if (!songs.length) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${SONGS_TAB}!A2`,
    valueInputOption: "RAW",
    requestBody: {
      values: songs.map((s) => [
        s.k || songKey(s.song, s.artist),
        s.section || "",
        s.song,
        s.artist,
        String(s.lead || "V1").toUpperCase(),
        s.len || "3:30",
        Number(s.energy) > 0 ? Number(s.energy) : "",
        Array.isArray(s.tags) ? s.tags.join(",") : String(s.tags || ""),
        Number(s.order) > 0 ? Number(s.order) : "",
        forceValue(s.force),
      ]),
    },
  });
}

/**
 * Human-readable matrix: one row per song, one column per voter. Derived and
 * disposable — cleared and rewritten on each save, and the caller wraps this
 * in try/catch so a formatting failure never fails the actual vote.
 */
export async function writeGrid(songs, voters, tunings = {}, learners = {}) {
  await ensureTabs();
  const sheets = sheetsClient();
  const id = sheetId();
  // Columns follow the current lists, so someone who has left the band stops
  // appearing here even though their row is still on the Votes tab.
  const who = VOTERS.filter(
    (n) => voters[n] && Object.keys(voters[n].votes || {}).length
  );
  const knows = BAND.filter(
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
    range: `${GRID_TAB}!A1:AZ600`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${GRID_TAB}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [header, ...rows] },
  });
}

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
