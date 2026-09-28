import { test } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.js";
import { makeFakeSheets } from "./fakeSheets.js";
import { twoShows } from "./nov.fixture.js";
import { setSheetsClient, HEADERS } from "../api/_sheets.js";
import admin from "../api/admin.js";
import data from "../api/data.js";
import vote from "../api/vote.js";
import lyrics from "../api/lyrics.js";

const LIB = [HEADERS.LIBRARY_HEADERS, ["jump-vanhalen", "Jump", "Van Halen", "3:58", "1984", "70s/80s", "130", "4", "opener", "V1", "ADDS"]];
const fresh = (extra = {}) => {
  const fake = makeFakeSheets({ ...twoShows(), Library: LIB, ...extra });
  setSheetsClient(fake);
  return fake;
};
const own = (body) => call(admin, { method: "POST", body: { show: "nov", ownerCode: "owner", ...body } });
const row = async (show, k) => (await call(data, { query: { show } })).json.data.rows.find((r) => r.k === k);

test("adding a song the library knows brings its facts; votes do not come with it", async () => {
  fresh();
  const r = await own({ add: [{ song: "Jump", artist: "Van Halen" }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const j = await row("nov", "jump-vanhalen");
  assert.equal(j.len, "3:58");
  assert.equal(j.year, "1984");
  assert.equal(j.energy, 4);
  assert.deepEqual(j.tags, ["opener"]);
  assert.equal(j.keyboard, "ADDS");
  assert.equal(j.bpm, 130);
  assert.deepEqual(Object.values(j.votes).filter(Boolean), []);
});

test("what the form says beats the library", async () => {
  fresh();
  await own({ add: [{ song: "Jump", artist: "Van Halen", length: "4:02", energy: 5, tags: "closer" }] });
  const j = await row("nov", "jump-vanhalen");
  assert.equal(j.len, "4:02");
  assert.equal(j.energy, 5);
  assert.deepEqual(j.tags, ["closer"]);
});

test("an edit flows back to the library, keeping its tempo", async () => {
  const fake = fresh();
  await own({ update: [{ key: "kiss-prince", energy: 3, keyboard: "ESSENTIAL" }] });
  const lib = fake.snapshot().Library.find((r) => r[0] === "kiss-prince");
  assert.ok(lib, "the edited song is now in the library");
  assert.equal(lib[7], "3");
  assert.equal(lib[10], "ESSENTIAL");
  await own({ update: [{ key: "jump-vanhalen", energy: 2 }] });
  assert.equal(fake.snapshot().Library.find((r) => r[0] === "jump-vanhalen")[6], "130");
});

test("a rename keeps the key, so votes and lyrics survive it", async () => {
  fresh();
  await call(vote, { method: "POST", body: { show: "nov", code: "band", voter: "Rich", votes: { "kiss-prince": "MUST" } } });
  await call(lyrics, { method: "POST", body: { show: "nov", code: "band", key: "kiss-prince", lyrics: "words" } });
  await own({ update: [{ key: "kiss-prince", song: "Kiss (live)" }] });
  const j = await row("nov", "kiss-prince");
  assert.equal(j.song, "Kiss (live)");
  assert.equal(j.votes.Rich, "MUST");
  assert.equal(j.hasLyrics, true);
});

test("'-' in Tags stays empty even when the library has tags", async () => {
  fresh({ "nov·Songs": [HEADERS.SONG_HEADERS, ["jump-vanhalen", "Ballot", "Jump", "Van Halen", "", "3:58", "", "-", "", "", "", "", ""]] });
  const j = await row("nov", "jump-vanhalen");
  // Uncurated row, so the library's energy and tags fill in...
  assert.equal(j.energy, 4);
  // ...but the row's own "-" wins over the library's tags.
  assert.deepEqual(j.tags, ["-"]);
});

test("October never borrows library facts, so its order cannot move", async () => {
  fresh({ Songs: [HEADERS.SONG_HEADERS, ["jump-vanhalen", "Arena", "Jump", "Van Halen", "V1", "3:58", "", "", "", "", "", "", ""]] });
  const j = await row("oct", "jump-vanhalen");
  assert.equal(j.energy, 0);
  assert.deepEqual(j.tags, []);
  assert.equal(j.keyboard, "");
});
