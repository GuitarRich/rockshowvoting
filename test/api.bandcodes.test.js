/**
 * Two bands, two codes: a show's own band code works for that show only, so
 * one band cannot save to another band's show.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.js";
import { makeFakeSheets } from "./fakeSheets.js";
import { twoShows } from "./nov.fixture.js";
import { setSheetsClient } from "../api/_sheets.js";
import vote from "../api/vote.js";
import learn from "../api/learn.js";
import lyrics from "../api/lyrics.js";
import shows from "../api/shows.js";
import data from "../api/data.js";

const fresh = () => setSheetsClient(makeFakeSheets(twoShows()));
const owner = (update) => call(shows, { method: "POST", body: { ownerCode: "owner", update } });
const voteAs = (show, code, voter = "Rich") =>
  call(vote, { method: "POST", body: { show, code, voter, votes: {} } });

test("each show takes its own code and refuses the other band's", async () => {
  fresh();
  assert.equal((await owner({ id: "oct", requireBandCode: true, bandCode: "october-band" })).status, 200);
  assert.equal((await owner({ id: "nov", bandCode: "buns-band" })).status, 200);
  assert.equal((await voteAs("oct", "october-band")).status, 200);
  assert.equal((await voteAs("nov", "buns-band")).status, 200);
  assert.equal((await voteAs("oct", "buns-band")).status, 401, "November's code does not open October");
  assert.equal((await voteAs("nov", "october-band")).status, 401, "October's code does not open November");
  assert.equal((await voteAs("oct", "band")).status, 401, "the shared code no longer works once a show has its own");
  const l = await call(learn, { method: "POST", body: { show: "oct", code: "buns-band", person: "Rich", learn: {} } });
  assert.equal(l.status, 401);
  const w = await call(lyrics, { method: "POST", body: { show: "oct", code: "buns-band", key: "jump-vanhalen", lyrics: "x" } });
  assert.equal(w.status, 401);
});

test("a show without its own code falls back to the shared BAND_SECRET", async () => {
  fresh();
  assert.equal((await voteAs("nov", "band")).status, 200);
  await owner({ id: "nov", bandCode: "buns-band" });
  await owner({ id: "nov", bandCode: "" });
  assert.equal((await voteAs("nov", "band")).status, 200, "removing the own code goes back to the shared one");
});

test("codes are never sent to a page, and ?detail=1 only says whether one is set", async () => {
  fresh();
  await owner({ id: "nov", bandCode: "buns-band" });
  const d = await call(data, { query: { show: "nov" } });
  assert.ok(!JSON.stringify(d.json).includes("buns-band"));
  const s = await call(shows, { query: { detail: "1" } });
  assert.ok(!JSON.stringify(s.json).includes("buns-band"));
  assert.deepEqual(s.json.shows.map((x) => [x.id, x.hasOwnBandCode]), [["oct", false], ["nov", true]]);
});

test("setting a code needs the owner code and at least 4 characters", async () => {
  fresh();
  const r = await call(shows, { method: "POST", body: { ownerCode: "band", update: { id: "nov", bandCode: "abcd" } } });
  assert.equal(r.status, 403);
  assert.equal((await owner({ id: "nov", bandCode: "ab" })).status, 400);
});

test("a new show can be created with its own code, which is not copied from its source", async () => {
  fresh();
  await owner({ id: "nov", bandCode: "buns-band" });
  const c = await call(shows, { method: "POST", body: { ownerCode: "owner", create: { id: "xmas", name: "Xmas", copyFrom: "nov", bandCode: "xmas-band" } } });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal((await voteAs("xmas", "buns-band")).status, 401);
});
