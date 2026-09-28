import { test } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.js";
import { makeFakeSheets } from "./fakeSheets.js";
import { twoShows } from "./nov.fixture.js";
import { setSheetsClient, HEADERS } from "../api/_sheets.js";
import lyrics from "../api/lyrics.js";
import tempos from "../api/tempos.js";
import data from "../api/data.js";

const fresh = (extra = {}) => {
  const fake = makeFakeSheets({ ...twoShows(), ...extra });
  setSheetsClient(fake);
  return fake;
};
const save = (body) => call(lyrics, { method: "POST", body: { show: "nov", ...body } });

test("saving words needs November's band code", async () => {
  fresh();
  assert.equal((await save({ key: "kiss-prince", lyrics: "x" })).status, 401);
});

test("a save upserts exactly one Lyrics row", async () => {
  const fake = fresh();
  assert.equal((await save({ code: "band", key: "kiss-prince", lyrics: "one" })).status, 200);
  assert.equal((await save({ code: "band", key: "Kiss|Prince", lyrics: "two" })).status, 200);
  const rows = fake.snapshot().Lyrics.slice(1);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], ["kiss-prince", "Kiss", "Prince", "two"]);
});

test("more than 20,000 characters is refused", async () => {
  fresh();
  const r = await save({ code: "band", key: "kiss-prince", lyrics: "a".repeat(20001) });
  assert.equal(r.status, 400);
});

test("an unknown song is a 404", async () => {
  fresh();
  assert.equal((await save({ code: "band", key: "nope-nobody", lyrics: "x" })).status, 404);
});

test("GET returns words for the set only, unless all=1", async () => {
  fresh({
    Lyrics: [HEADERS.LYRICS_HEADERS, ["kiss-prince", "Kiss", "Prince", "k"], ["freak-silverchair", "Freak", "Silverchair", "f"],
      ["riffraff-acdc", "Riff Raff", "AC/DC", "r"], ["sabotage-beastieboys", "Sabotage", "Beastie Boys", "s"]],
    "nov·Votes": [HEADERS.VOTE_HEADERS, ["Rich", "1", "", "1", JSON.stringify({ "freak-silverchair": "NO" })]],
  });
  const set = await call(lyrics, { query: { show: "nov" } });
  assert.deepEqual(Object.keys(set.json.lyrics).sort(), ["kiss-prince", "riffraff-acdc", "sabotage-beastieboys"]);
  const all = await call(lyrics, { query: { show: "nov", all: "1" } });
  assert.equal(Object.keys(all.json.lyrics).length, 4);
});

test("lyrics belong to the song, so October sees words saved under November", async () => {
  fresh({ "nov·Songs": [HEADERS.SONG_HEADERS, ["jump-vanhalen", "Ballot", "Jump", "Van Halen", "", "3:58", "4", "", "", "", "", "", ""]] });
  await save({ code: "band", key: "jump-vanhalen", lyrics: "Might as well jump" });
  const r = await call(lyrics, { query: {} });
  assert.equal(r.json.lyrics["jump-vanhalen"], "Might as well jump");
});

test("addBlankRows gives each set song a row, once", async () => {
  const fake = fresh();
  await save({ code: "band", addBlankRows: true });
  await save({ code: "band", addBlankRows: true });
  assert.equal(fake.snapshot().Lyrics.length - 1, 3);
});

test("tempos: range checked, code required, and the page sees them as saved", async () => {
  fresh({ Library: [HEADERS.LIBRARY_HEADERS, ["kiss-prince", "Kiss", "Prince", "", "", "", "111", "", "", "", ""]] });
  const post = (body) => call(tempos, { method: "POST", body: { show: "nov", key: "kiss-prince", ...body } });
  assert.equal((await post({ code: "band", bpm: 400 })).status, 400);
  assert.equal((await post({ bpm: 120 })).status, 401);
  let d = (await call(data, { query: { show: "nov" } })).json.data.rows.find((r) => r.k === "kiss-prince");
  assert.equal(d.bpm, 111);
  assert.equal(d.bpmSource, "est");
  const ok = await post({ code: "band", bpm: 120, beats: 3 });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.json.bpm, ok.json.beats, ok.json.bpmSource], [120, 3, "set"]);
});
