/**
 * Move Bun's & Roses (the Band Vote app) in as the November show.
 *
 *     pnpm migrate:nov                         dry run: report only, writes nothing
 *     pnpm migrate:nov -- --apply --gig=2026-11-21 [--occasion="..."]
 *     pnpm migrate:nov -- --verify
 *
 * The Band Vote sheet is opened with a READ-ONLY scope, so nothing this
 * script does can change it. --apply refuses to run without a backup of this
 * app's sheet from today (pnpm backup), and refuses to overwrite a nov show
 * that already exists.
 *
 * Credentials come from .env.development.local (pnpm env): the same service
 * account reads both sheets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { google } from "googleapis";
import {
  sheetsClient, sheetId, readShows, readAll, ensureTabs, writeTabRows, appendShow,
  TABS, HEADERS,
} from "../api/_sheets.js";
import { buildPayload } from "../api/_payload.js";
import { hasBackupToday } from "./backup-sheet.js";
import { buildNovTabs, parseAdded, keyMap } from "./lib/bandvote-map.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "scripts/out");
const SOURCE_ID = "14nIIefs1Jks8kaU2YzuSLbpuXPDQqzW-zt4asu5TYS0";
const BV_DIR = path.resolve(ROOT, "../band vote");
const NOV = { id: "nov", prefix: "nov·", name: "Bun's & Roses", status: "current", requireBandCode: true };

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const mode = args.apply ? "apply" : args.verify ? "verify" : "dry-run";
const { tracks } = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/fixtures/bandvote-tracks-v32.json")));

function readOnlyClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  if (!email || !key) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY — run `pnpm env` first.");
  const auth = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  return google.sheets({ version: "v4", auth });
}

const SOURCE_RANGES = {
  voteRows: "Votes!A2:E200",
  addedRows: "AddedSongs!A2:H500",
  setlistRows: "Setlist!A2:E500",
  progressRows: "Progress!A1:Z500",
  settingsRows: "Settings!A2:B50",
  lyricsRows: "Lyrics!A2:D500",
  tempoRows: "Tempos!A2:E500",
  tuningRows: "Tunings!A2:D500",
};

async function readSource() {
  const src = readOnlyClient();
  let meta;
  try {
    meta = await src.spreadsheets.get({ spreadsheetId: SOURCE_ID });
  } catch (e) {
    if (/permission|403|forbidden/i.test(e.message)) {
      throw new Error(
        `The service account cannot read the Band Vote sheet. Share it with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} as a Viewer, then run this again.`
      );
    }
    throw e;
  }
  const titles = new Set(meta.data.sheets.map((s) => s.properties.title));
  const names = Object.keys(SOURCE_RANGES).filter((k) => titles.has(SOURCE_RANGES[k].split("!")[0]));
  const res = await src.spreadsheets.values.batchGet({
    spreadsheetId: SOURCE_ID,
    ranges: names.map((k) => SOURCE_RANGES[k]),
    valueRenderOption: "FORMATTED_VALUE",
  });
  const out = { title: meta.data.properties.title, counts: {} };
  for (const k of Object.keys(SOURCE_RANGES)) out[k] = [];
  names.forEach((k, i) => {
    out[k] = res.data.valueRanges[i].values || [];
    out.counts[k] = out[k].length;
  });
  return out;
}

async function readExisting() {
  const sheets = sheetsClient();
  const id = sheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const have = new Set(meta.data.sheets.map((s) => s.properties.title));
  const get = async (tab, range) =>
    have.has(tab)
      ? (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${tab}'!${range}` })).data.values || []
      : [];
  const tunings = {};
  for (const r of await get(TABS.TUNINGS_TAB, "A2:D1000")) if (r[0]) tunings[String(r[0]).trim()] = String(r[3] || "").trim();
  const lyrics = {};
  for (const r of await get(TABS.LYRICS_TAB, "A2:D1000")) if (r[0]) lyrics[String(r[0]).trim()] = String(r[3] || "");
  const tempos = {};
  for (const r of await get(TABS.TEMPOS_TAB, "A2:E1000")) if (r[0]) tempos[String(r[0]).trim()] = { bpm: r[3], beats: r[4] };
  const library = new Set((await get(TABS.LIBRARY_TAB, "A2:A1000")).map((r) => String(r[0] || "").trim()));
  return { tunings, lyrics, tempos, library, tabs: [...have] };
}

/** Band Vote's own answer to "what is in the set", using Band Vote's own code. */
async function bandVoteSet(source) {
  const bv = await import(pathToFileURL(path.join(BV_DIR, "setlist.js")).href);
  const cat = await import(pathToFileURL(path.join(BV_DIR, "catalog.js")).href);
  const added = parseAdded(source.addedRows).map((a) => ({
    k: a.k, name: a.name, artist: a.artist, dur: a.seconds, set: a.era, energy: a.energy || "", tags: a.tags, lead: a.lead,
  }));
  const songs = cat.buildSongs(added);
  const pool = {};
  for (const r of source.voteRows) {
    try {
      pool[r[0]] = JSON.parse(r[4] || "{}");
    } catch {
      /* reported elsewhere */
    }
  }
  const plan = bv.parseSetlist(source.setlistRows);
  const limit = bv.parseSettings(source.settingsRows).songLimit;
  const include = Object.keys(plan.states).filter((k) => plan.states[k] === "in");
  const exclude = Object.keys(plan.states).filter((k) => plan.states[k] === "out");
  const sel = bv.selectSet(bv.scoreSongs(songs, pool), { targetSongs: limit, include, exclude });
  const map = keyMap(tracks, parseAdded(source.addedRows));
  return { ok: sel.ok, error: sel.error, keys: sel.keep.map((s) => map.get(s.k)).sort(), limit };
}

/** What this app would serve for November from the prepared rows. */
async function ourSetFromRows(out) {
  const { makeFakeSheets } = await import(pathToFileURL(path.join(ROOT, "test/fakeSheets.js")).href);
  const { setSheetsClient } = await import("../api/_sheets.js");
  const H = HEADERS;
  setSheetsClient(makeFakeSheets({
    Shows: [H.SHOW_HEADERS, ["oct", "", "October", "", "current", "FALSE"], ["nov", "nov·", NOV.name, "", "current", "TRUE"]],
    "nov·Songs": [H.SONG_HEADERS, ...out.tabs.Songs],
    "nov·Votes": [H.VOTE_HEADERS, ...out.tabs.Votes],
    "nov·Learning": [H.LEARN_HEADERS, ...out.tabs.Learning],
    "nov·Settings": [H.SETTINGS_HEADERS, ...out.tabs.Settings],
    Library: [H.LIBRARY_HEADERS, ...out.library.Library],
  }));
  const d = buildPayload(await readAll(NOV));
  setSheetsClient(null);
  return { keys: d.rows.filter((r) => r.inSet).map((r) => r.k).sort(), order: d.set.order, rows: d.rows };
}

function report(source, out, bvSet, ours) {
  const same = JSON.stringify(bvSet.keys) === JSON.stringify(ours.keys);
  const title = (k) => {
    const s = out.songs.find((x) => x.k === k);
    return s ? `${s.song} — ${s.artist}` : k;
  };
  const lines = [
    "# November migration report (dry run)",
    "",
    `Source: **${source.title}** (\`${SOURCE_ID}\`), read-only. Generated ${new Date().toISOString()}.`,
    "",
    "## Songs",
    "",
    `- Built-in songs mapped from positions b0–b${tracks.length - 1}: **${tracks.length}**`,
    `- Songs added in Band Vote: **${out.songs.filter((s) => s.added).length}**`,
    `- Total on the November ballot, after merging duplicates: **${out.songs.length}**`,
    `- Keys that could not be mapped (dropped): ${out.report.unmapped.length ? out.report.unmapped.join(", ") : "none"}`,
    "",
    "## Votes",
    "",
    "| Voter | Votes |",
    "|---|---|",
    ...Object.entries(out.voteCounts).map(([n, c]) => `| ${n} | ${c} |`),
    "",
    `Voters: ${out.settings.voters.join(", ")}. Band (plays and learns): ${out.settings.band.join(", ")}.`,
    "",
    "## Learning status",
    "",
    ...(Object.keys(out.learnCounts).length
      ? Object.entries(out.learnCounts).map(([n, c]) => `- ${n}: ${c} songs marked`)
      : ["- nobody has marked anything"]),
    "",
    "## Library content",
    "",
    `- Lyrics rows to add: **${out.library.Lyrics.length}** (${out.library.Lyrics.filter((r) => String(r[3]).trim()).length} with words)`,
    `- Tempo rows to add: **${out.library.Tempos.length}**`,
    `- Tuning rows to add: **${out.library.Tunings.length}**`,
    `- Library rows to add: **${out.library.Library.length}**`,
    "",
    "### Merged duplicates and other notes",
    "",
    ...(out.report.notes.length ? out.report.notes.map((c) => `- ${c}`) : ["- none"]),
    "",
    "### Clashes (the value kept is named)",
    "",
    ...(out.report.clashes.length ? out.report.clashes.map((c) => `- ${c}`) : ["- none"]),
    "",
    "## Settings",
    "",
    "```json",
    JSON.stringify(out.settings, null, 2),
    "```",
    "",
    "## The set",
    "",
    `Band Vote's own code picks **${bvSet.keys.length}** songs (limit ${bvSet.limit})${bvSet.ok ? "" : ` — Band Vote reports: ${bvSet.error}`}.`,
    `This app picks **${ours.keys.length}**. ${same ? "✅ Identical." : "❌ They differ — see below."}`,
    "",
    "Running order as this app will show it:",
    "",
    ...ours.order.map((k, i) => `${i + 1}. ${title(k)}`),
    "",
  ];
  if (!same) {
    const onlyBv = bvSet.keys.filter((k) => !ours.keys.includes(k));
    const onlyUs = ours.keys.filter((k) => !bvSet.keys.includes(k));
    lines.push("Only in Band Vote's set: " + (onlyBv.map(title).join("; ") || "—"));
    lines.push("", "Only in this app's set: " + (onlyUs.map(title).join("; ") || "—"), "");
  }
  lines.push("## Source tab row counts", "", "```json", JSON.stringify(source.counts, null, 2), "```", "");
  return { text: lines.join("\n"), same };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const source = await readSource();
  const existing = await readExisting();
  const out = buildNovTabs({
    tracks,
    ...source,
    existing,
    gigDate: typeof args.gig === "string" ? args.gig : "",
    occasion: typeof args.occasion === "string" ? args.occasion : "",
  });

  if (mode === "dry-run") {
    const bvSet = await bandVoteSet(source);
    const ours = await ourSetFromRows(out);
    const r = report(source, out, bvSet, ours);
    fs.writeFileSync(path.join(OUT, "nov-migration-report.md"), r.text);
    fs.writeFileSync(path.join(OUT, "nov-source-counts.json"), JSON.stringify(source.counts, null, 2));
    console.log(r.text);
    console.log(`\nWrote scripts/out/nov-migration-report.md. Nothing was written to either sheet.`);
    return;
  }

  if (mode === "apply") {
    if (args.gig && !/^\d{4}-\d{2}-\d{2}$/.test(String(args.gig))) throw new Error("--gig must be YYYY-MM-DD");
    if (!(await hasBackupToday())) throw new Error("No backup from today. Run `pnpm backup` first.");
    const shows = await readShows();
    if (shows.some((s) => s.id === "nov")) throw new Error("A nov show already exists. Refusing to overwrite it.");
    const show = { ...NOV, gigDate: out.settings.gigDate };
    await ensureTabs(show);
    await writeTabRows(show, TABS.SONGS_TAB, out.tabs.Songs, HEADERS.SONG_HEADERS.length);
    await writeTabRows(show, TABS.VOTES_TAB, out.tabs.Votes, 5);
    await writeTabRows(show, TABS.LEARN_TAB, out.tabs.Learning, 5);
    await writeTabRows(show, TABS.SETTINGS_TAB, out.tabs.Settings, 2);
    const sheets = sheetsClient();
    for (const [tab, rows] of Object.entries(out.library)) {
      if (!rows.length) continue;
      const width = rows[0].length;
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId(),
        range: `'${tab}'!A2:${String.fromCharCode(64 + width)}2`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows },
      });
      console.log(`appended ${rows.length} row(s) to ${tab}`);
    }
    await appendShow(show);
    console.log("November is in. Now run: pnpm migrate:nov -- --verify");
    return;
  }

  // --verify: re-read both sheets and compare what matters
  const shows = await readShows();
  const nov = shows.find((s) => s.id === "nov");
  if (!nov) throw new Error("No nov show yet.");
  const d = buildPayload(await readAll(nov));
  const bvSet = await bandVoteSet(source);
  const problems = [];
  for (const [n, c] of Object.entries(out.voteCounts)) {
    const got = d.rows.filter((r) => r.votes[n]).length;
    if (got !== c) problems.push(`votes for ${n}: expected ${c}, app has ${got}`);
  }
  const lyricKeys = out.library.Lyrics.filter((r) => String(r[3]).trim()).map((r) => r[0]);
  const { readLyrics } = await import("../api/_sheets.js");
  const ourLyrics = await readLyrics();
  const missingWords = lyricKeys.filter((k) => !String(ourLyrics[k] || "").trim());
  if (missingWords.length) problems.push(`lyrics missing: ${missingWords.join(", ")}`);
  const ours = d.rows.filter((r) => r.inSet).map((r) => r.k).sort();
  if (JSON.stringify(ours) !== JSON.stringify(bvSet.keys)) problems.push("the set differs from Band Vote's");
  const before = fs.existsSync(path.join(OUT, "nov-source-counts.json"))
    ? JSON.parse(fs.readFileSync(path.join(OUT, "nov-source-counts.json")))
    : null;
  if (before) {
    for (const [k, v] of Object.entries(before)) {
      if (source.counts[k] !== v) problems.push(`Band Vote ${k} rows changed: ${v} → ${source.counts[k]} (someone is still using it)`);
    }
  }
  const lines = [
    `Verified ${new Date().toISOString()}`,
    `songs: ${d.rows.length}, set: ${d.set.count} (Band Vote: ${bvSet.keys.length})`,
    `votes: ${Object.entries(out.voteCounts).map(([n, c]) => `${n} ${c}`).join(", ")}`,
    `lyrics with words: ${lyricKeys.length}`,
    problems.length ? "PROBLEMS:\n  " + problems.join("\n  ") : "All counts match.",
  ];
  fs.writeFileSync(path.join(OUT, "nov-migration-verify.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  if (problems.length) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
