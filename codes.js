/**
 * Vote codes: the offline backup when saving is not working. A voter copies
 * their code, texts it to the owner, and the owner pastes it back in.
 *
 *   RS1-<show>~<name>~<songKey>=<M|Y|?|N|X>,...     this app's codes
 *   BR2- / BR1-                                     Band Vote's, still read
 *
 * Band Vote's codes address its 73 built-in songs by position, so reading
 * one needs the frozen v32 catalog (scripts/fixtures/bandvote-tracks-v32.json).
 * Pure functions: the pages and the tests share them.
 */
import { songKey } from "./setlist.js";

const TO_LETTER = { MUST: "M", YES: "Y", MAYBE: "?", NO: "N", X: "X" };
const FROM_LETTER = { M: "MUST", Y: "YES", "?": "MAYBE", N: "NO", X: "X" };
const FROM_NUMBER = { 3: "MUST", 2: "YES", 1: "MAYBE", 0: "NO" };
const clean = (s) => String(s == null ? "" : s).replace(/[~|,=\n\r]/g, " ").trim();

export function mkCode(show, name, votes) {
  const pairs = Object.entries(votes || {})
    .filter(([, v]) => TO_LETTER[v])
    .map(([k, v]) => k + "=" + TO_LETTER[v]);
  return "RS1-" + clean(show) + "~" + clean(name) + "~" + pairs.join(",");
}

/** A vote value from a code or a CSV cell: words, letters or Band Vote's 0–3. */
export function voteValue(raw) {
  const s = String(raw == null ? "" : raw).trim().toUpperCase();
  if (!s) return "";
  if (FROM_NUMBER[s] !== undefined && /^[0-3]$/.test(s)) return FROM_NUMBER[s];
  if (FROM_LETTER[s]) return FROM_LETTER[s];
  if (["MUST", "YES", "MAYBE", "NO", "X"].includes(s)) return s;
  if (s === "PASS") return "NO";
  if (s === "MUST PLAY") return "MUST";
  return "";
}

/**
 * One code → { show, name, votes: {songKey: value} }, or null.
 * `tracks` is the frozen Band Vote catalog, needed only for BR1/BR2 codes.
 */
export function rdCode(raw, tracks = []) {
  const c = String(raw || "").trim();
  let m = c.match(/^RS1-([^~]*)~([^~]+)~(.*)$/);
  if (m) {
    const votes = {};
    for (const pair of m[3].split(",").filter(Boolean)) {
      const [k, v] = pair.split("=");
      const val = voteValue(v);
      if (k && val) votes[k.trim()] = val;
    }
    return { show: m[1], name: m[2], votes };
  }
  const byPos = (bs, votes) => {
    for (let i = 0; i < tracks.length && i < bs.length; i++) {
      const ch = bs[i];
      if (ch >= "0" && ch <= "3") votes[songKey(tracks[i].name, tracks[i].artist)] = FROM_NUMBER[ch];
    }
  };
  m = c.match(/^BR2-([^~]+)~([0-3.]*)\|([^|]*)\|([^|]*)$/);
  if (m) {
    const votes = {};
    byPos(m[2], votes);
    for (const pair of (m[4] || "").split(",").filter(Boolean)) {
      const [k, v] = pair.split(":");
      const val = voteValue(v);
      if (k && val) votes[k] = val;   // added songs already use the slug key
    }
    return { show: "", name: m[1], votes };
  }
  m = c.match(/^BR1-([^~]+)~([0-3.]{1,200})$/);
  if (m) {
    const votes = {};
    byPos(m[2], votes);
    return { show: "", name: m[1], votes };
  }
  return null;
}

/** Minimal RFC-4180 CSV reader: quotes, doubled quotes, commas in quotes. */
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const t = String(text || "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
}

const RESERVED = new Set([
  "song", "artist", "year", "set", "section", "length", "duration", "added", "in set", "total",
  "votes cast", "score", "musts", "lead", "tuning", "#",
]);

/**
 * A votes CSV (this app's export, or Band Vote's) → { byName: {name: {k: v}},
 * unknown: n }. Songs are matched on Song + Artist; unknown songs are counted
 * and skipped — adding songs is the song admin's job.
 */
export function readVotesCSV(text, knownKeys) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { err: "That CSV has no rows under the header." };
  const head = rows[0].map((h) => String(h).trim());
  const iSong = head.findIndex((h) => /^song$/i.test(h));
  const iArt = head.findIndex((h) => /^artist$/i.test(h));
  if (iSong < 0 || iArt < 0) return { err: "Needs a Song column and an Artist column." };
  const who = head.map((h, i) => ({ name: h, i })).filter((w) => w.name && !RESERVED.has(w.name.toLowerCase()));
  if (!who.length) return { err: "No voter columns — each voter needs a column headed with their name." };
  const byName = {};
  let unknown = 0;
  for (const r of rows.slice(1)) {
    const k = songKey(r[iSong], r[iArt]);
    if (!knownKeys.has(k)) { unknown++; continue; }
    for (const w of who) {
      const v = voteValue(r[w.i]);
      if (v) (byName[w.name] ||= {})[k] = v;
    }
  }
  return { byName, unknown };
}
