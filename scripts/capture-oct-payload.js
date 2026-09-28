/**
 * Capture what the live October app serves today, as the regression baseline.
 *
 *     node scripts/capture-oct-payload.js https://rockshowvoting.vercel.app
 *
 * Writes:
 *   test/fixtures/oct-payload.json  the /api/data `data` object, verbatim
 *   test/fixtures/oct-sheet.json    sheet tabs rebuilt from it, to seed the fake
 *
 * Read-only: a single GET of /api/data, which every page already makes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.argv[2] || "").replace(/\/+$/, "");
if (!base) {
  console.error("Usage: node scripts/capture-oct-payload.js <production URL>");
  process.exit(1);
}

const res = await fetch(base + "/api/data");
const body = await res.json();
if (!body.ok) throw new Error("API said: " + body.error);
const data = body.data;

/** Rebuild the tabs the payload was made from. */
export function sheetFromPayload(d) {
  const Songs = [
    ["Key", "Section", "Song", "Artist", "Lead", "Length", "Energy", "Tags", "Order", "Force", "Keyboard"],
    ...d.rows.map((r) => [
      r.k, r.section, r.song, r.artist, r.lead, r.len,
      r.energy ? String(r.energy) : "", (r.tags || []).join(","),
      r.order ? String(r.order) : "", r.force || "", r.keyboard || "",
    ]),
  ];
  const perPerson = (names, pick) =>
    names
      .map((n) => {
        const blob = {};
        for (const r of d.rows) {
          const v = pick(r)[n];
          if (v) blob[r.k] = v;
        }
        return [n, blob];
      })
      .filter(([, blob]) => Object.keys(blob).length);

  const Votes = [
    ["Name", "UpdatedAt", "AppVersion", "VoteCount", "VotesJSON"],
    ...perPerson(d.voters, (r) => r.votes).map(([n, b]) => [n, "1", "", String(Object.keys(b).length), JSON.stringify(b)]),
  ];
  const Learning = [
    ["Name", "UpdatedAt", "AppVersion", "KnownCount", "LearnJSON"],
    ...perPerson(d.learners, (r) => r.learn).map(([n, b]) => [
      n, "1", "", String(Object.values(b).filter((v) => v === "KNOW").length), JSON.stringify(b),
    ]),
  ];
  const Availability = [
    ["Name", "UpdatedAt", "AppVersion", "DaysFree", "DaysJSON"],
    ...Object.entries(d.availability || {})
      .filter(([, days]) => Object.keys(days).length)
      .map(([n, days]) => [n, "1", "", String(Object.values(days).filter((v) => v === "YES").length), JSON.stringify(days)]),
  ];
  const Tunings = [
    ["Key", "Song", "Artist", "Tuning"],
    ...d.rows.map((r) => [r.k, r.song, r.artist, r.tuning || ""]),
  ];
  const lockedKeys = d.set.locked
    ? d.rows.filter((r) => r.inSet && r.force !== "IN").map((r) => r.k)
    : [];
  const Settings = [
    ["Key", "Value"],
    ["maxSongs", String(d.set.maxSongs || 0)],
    ["locked", d.set.locked ? "true" : "false"],
    ["lockedKeys", JSON.stringify(lockedKeys)],
    ["gigDate", d.gigDate || ""],
  ];
  return { Songs, Votes, Learning, Availability, Tunings, Settings, Grid: [] };
}

fs.writeFileSync(path.join(ROOT, "test/fixtures/oct-payload.json"), JSON.stringify(data, null, 2) + "\n");
fs.writeFileSync(path.join(ROOT, "test/fixtures/oct-sheet.json"), JSON.stringify(sheetFromPayload(data), null, 1) + "\n");
console.log(`Captured ${data.rows.length} songs, ${data.voters.length} voters, set of ${data.set.count}.`);
