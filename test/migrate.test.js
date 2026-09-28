import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  mapVote, mapProgress, mapState, secsToMmss, keyMap, parseAdded, crossCheck, buildNovTabs,
} from "../scripts/lib/bandvote-map.js";
import "./helpers.js";
import { makeFakeSheets } from "./fakeSheets.js";
import { setSheetsClient, readAll, HEADERS } from "../api/_sheets.js";
import { buildPayload } from "../api/_payload.js";
import { songKey } from "../setlist.js";

const { tracks } = JSON.parse(
  fs.readFileSync(new URL("../scripts/fixtures/bandvote-tracks-v32.json", import.meta.url))
);
const ADDED = [["gloria-them", "Gloria", "Them", "158", "1", "4", "opener", ""]];
const b = (i) => songKey(tracks[i].name, tracks[i].artist);

function source(extra = {}) {
  return {
    tracks,
    addedRows: ADDED,
    voteRows: [
      ["Rich", "1700", "v32", "3", JSON.stringify({ b0: 3, b1: 0, "gloria-them": 2, b999: 3 })],
      ["Joel", "1701", "v32", "2", JSON.stringify({ b0: "2", b72: 1 })],
      ["Guest", "1702", "v32", "1", JSON.stringify({ b1: 3 })],
    ],
    setlistRows: [
      ["b0", tracks[0].name, tracks[0].artist, "in", "2"],
      ["b1", tracks[1].name, tracks[1].artist, "out", ""],
      ["gloria-them", "Gloria", "Them", "", "1"],
    ],
    progressRows: [
      ["Key", "Title", "Artist", "Rich", "Joel"],
      ["b0", tracks[0].name, tracks[0].artist, "know-it", "in-progress"],
      ["b72", tracks[72].name, tracks[72].artist, "", "not-started"],
    ],
    settingsRows: [["Song limit", "17"]],
    lyricsRows: [
      [b(0), tracks[0].name, tracks[0].artist, "words\nmore words"],
      ["gloria-them", "Gloria", "Them", "G-L-O-R-I-A"],
    ],
    tempoRows: [[b(0), tracks[0].name, tracks[0].artist, "121", "4"]],
    tuningRows: [
      [b(0), tracks[0].name, tracks[0].artist, "E standard"],
      ["jump-vanhalen", "Jump", "Van Halen", "E standard"],
    ],
    existing: { tunings: { "jump-vanhalen": "Eb standard" }, lyrics: {}, tempos: {}, library: new Set() },
    ...extra,
  };
}

test("value transforms", () => {
  assert.equal(mapVote(3), "MUST");
  assert.equal(mapVote("2"), "YES");
  assert.equal(mapVote(1), "MAYBE");
  assert.equal(mapVote(0), "NO");
  assert.equal(mapVote(""), null);
  assert.equal(mapVote(7), null);
  assert.equal(mapProgress("know-it"), "KNOW");
  assert.equal(mapProgress("In Progress"), "IN PROGRESS");
  assert.equal(mapProgress("not-started"), "NOT STARTED");
  assert.equal(mapProgress(""), null);
  assert.equal(mapState("in"), "IN");
  assert.equal(mapState("OUT"), "OUT");
  assert.equal(mapState("maybe"), "");
  assert.equal(secsToMmss(189), "3:09");
});

test("key map covers all 73 built-ins and the added songs", () => {
  const m = keyMap(tracks, parseAdded(ADDED));
  assert.equal(tracks.length, 73);
  assert.equal(m.get("b0"), songKey("I Wanna Be Your Dog", "The Stooges"));
  assert.equal(m.get("b72"), songKey("Do I Wanna Know?", "Arctic Monkeys"));
  assert.equal(m.get("gloria-them"), "gloria-them");
  assert.equal(m.size, 74);
});

test("cross-check refuses a row whose title disagrees with its position", () => {
  const m = keyMap(tracks, []);
  assert.throws(() => crossCheck([["b0", "Wrong Song", "Nobody"]], m), /cross-check failed/);
  assert.doesNotThrow(() => crossCheck([["b0", tracks[0].name, tracks[0].artist]], m));
});

test("buildNovTabs maps votes, set state, learning and settings", () => {
  const out = buildNovTabs(source());
  const votes = Object.fromEntries(out.tabs.Votes.map((r) => [r[0], JSON.parse(r[4])]));
  assert.deepEqual(votes.Rich, { [b(0)]: "MUST", [b(1)]: "NO", "gloria-them": "YES" });
  assert.deepEqual(votes.Joel, { [b(0)]: "YES", [b(72)]: "MAYBE" });
  assert.deepEqual(out.report.unmapped, ["b999"]);

  const byK = Object.fromEntries(out.songs.map((s) => [s.k, s]));
  assert.equal(byK[b(0)].force, "IN");
  assert.equal(byK[b(1)].force, "OUT");
  assert.equal(byK["gloria-them"].order, 1);
  assert.equal(byK[b(0)].order, 2);
  assert.equal(byK[b(0)].len, "3:09");
  assert.equal(byK[b(0)].era, "70s/80s");
  assert.equal(out.songs.length, 74);

  const learn = Object.fromEntries(out.tabs.Learning.map((r) => [r[0], JSON.parse(r[4])]));
  assert.deepEqual(learn.Rich, { [b(0)]: "KNOW" });
  assert.deepEqual(learn.Joel, { [b(0)]: "IN PROGRESS", [b(72)]: "NOT STARTED" });

  assert.equal(out.settings.maxSongs, 17);
  assert.deepEqual(out.settings.voters, ["Rich", "Joel", "Anders", "Pete", "Guest"]);
  assert.deepEqual(out.settings.band, ["Rich", "Joel", "Anders", "Pete"]);
});

test("library tabs only gain rows; a tuning clash keeps this app's value", () => {
  const out = buildNovTabs(source());
  assert.equal(out.library.Lyrics.length, 2);
  assert.equal(out.library.Tempos.length, 1);
  assert.deepEqual(out.library.Tunings.map((r) => r[0]), [b(0)]);
  assert.ok(out.report.clashes.some((c) => c.includes("jump-vanhalen")));
  assert.equal(out.library.Library.length, 74);
  const again = buildNovTabs(source({ existing: { tunings: {}, lyrics: { [b(0)]: "other words" }, tempos: {}, library: new Set([b(0)]) } }));
  assert.equal(again.library.Lyrics.length, 1, "existing lyrics are never overwritten");
  assert.ok(again.report.clashes.some((c) => c.startsWith("Lyrics")));
  assert.equal(again.library.Library.length, 73);
});

test("the nov· tabs round-trip through the app's own reader", async () => {
  const out = buildNovTabs(source());
  const H = HEADERS;
  const fake = makeFakeSheets({
    Shows: [H.SHOW_HEADERS, ["oct", "", "October", "", "current", "FALSE"], ["nov", "nov·", "Bun's & Roses", "", "current", "TRUE"]],
    "nov·Songs": [H.SONG_HEADERS, ...out.tabs.Songs],
    "nov·Votes": [H.VOTE_HEADERS, ...out.tabs.Votes],
    "nov·Learning": [H.LEARN_HEADERS, ...out.tabs.Learning],
    "nov·Settings": [H.SETTINGS_HEADERS, ...out.tabs.Settings],
    Library: [H.LIBRARY_HEADERS, ...out.library.Library],
    Tempos: [H.TEMPO_HEADERS, ...out.library.Tempos],
  });
  setSheetsClient(fake);
  const state = await readAll({ id: "nov", prefix: "nov·", name: "Bun's & Roses", status: "current", requireBandCode: true });
  const d = buildPayload(state);
  assert.equal(d.rows.length, 74);
  assert.equal(d.set.maxSongs, 17);
  assert.equal(d.set.count, 17);
  assert.ok(d.rows.find((r) => r.k === b(0)).inSet, "forced in");
  assert.ok(!d.rows.find((r) => r.k === b(1)).inSet, "forced out");
  assert.equal(d.rows.find((r) => r.k === b(0)).votes.Rich, "MUST");
  assert.equal(d.rows.find((r) => r.k === b(0)).learn.Rich, "KNOW");
  assert.equal(d.rows.find((r) => r.k === b(0)).bpmSource, "set");
  assert.equal(d.rows.find((r) => r.k === b(2)).bpmSource, "est");
  assert.equal(d.rows.find((r) => r.k === b(2)).bpm, tracks[2].bpm);
  // Saved positions lead; everything else closes up behind them.
  assert.deepEqual(d.set.order.slice(0, 2), ["gloria-them", b(0)]);
});

test("a song that is both built-in and added merges into one, keeping the copy with the votes", () => {
  const dupe = [String("youreallygotme-vanhalen"), "You Really Got Me", "Van Halen", "170", "1", "5", "", ""];
  const i = tracks.findIndex((t) => t.name === "You Really Got Me");
  assert.ok(i >= 0);
  const out = buildNovTabs(source({
    addedRows: [...ADDED, dupe],
    voteRows: [["Rich", "1", "v32", "1", JSON.stringify({ "youreallygotme-vanhalen": 2 })]],
    setlistRows: [
      [`b${i}`, "You Really Got Me", "Van Halen", "", ""],
      ["youreallygotme-vanhalen", "You Really Got Me", "Van Halen", "in", "3"],
    ],
  }));
  const k = "youreallygotme-vanhalen";
  assert.equal(out.songs.filter((s) => s.k === k).length, 1);
  const song = out.songs.find((s) => s.k === k);
  assert.equal(song.added, false, "the built-in copy's facts win");
  assert.equal(song.force, "IN");
  assert.equal(song.order, 1);
  assert.equal(JSON.parse(out.tabs.Votes[0][4])[k], "YES");
  assert.ok(out.report.notes.some((n) => n.includes(k)));
});
