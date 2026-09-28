import { test } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.js";
import { makeFakeSheets } from "./fakeSheets.js";
import { twoShows } from "./nov.fixture.js";
import { setSheetsClient } from "../api/_sheets.js";
import shows from "../api/shows.js";
import data from "../api/data.js";
import vote from "../api/vote.js";
import admin from "../api/admin.js";

const fresh = () => {
  const fake = makeFakeSheets(twoShows());
  setSheetsClient(fake);
  return fake;
};
const create = (c, code = "owner") => call(shows, { method: "POST", body: { ownerCode: code, create: c } });

test("GET lists shows and the default", async () => {
  fresh();
  const r = await call(shows, {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.shows.map((s) => s.id), ["oct", "nov"]);
  assert.ok(["oct", "nov"].includes(r.json.defaultId));
});

test("creating a show copies songs and settings, never votes", async () => {
  const fake = fresh();
  await call(vote, { method: "POST", body: { show: "nov", code: "band", voter: "Rich", votes: { "kiss-prince": "MUST" } } });
  const r = await create({ id: "test", name: "Test Show", gigDate: "2027-01-10", copyFrom: "nov" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const snap = fake.snapshot();
  assert.equal(snap["test·Songs"].length - 1, 4);
  assert.equal((snap["test·Votes"] || []).length, 1, "header only");
  const d = (await call(data, { query: { show: "test" } })).json.data;
  assert.equal(d.show.name, "Test Show");
  assert.equal(d.show.gigDate, "2027-01-10");
  assert.deepEqual(d.voters, ["Rich", "Joel", "Anders", "Pete"]);
  assert.equal(d.settings.maxPerArtist, 1);
  assert.equal(d.rows.find((x) => x.k === "kiss-prince").votes.Rich, "");
  assert.equal(d.show.requireBandCode, true);
});

test("create refuses a duplicate id, a bad id, and no owner code", async () => {
  fresh();
  assert.equal((await create({ id: "nov", name: "x" })).status, 409);
  assert.equal((await create({ id: "Bad Id!", name: "x" })).status, 400);
  assert.equal((await create({ id: "ok", name: "x" }, "band")).status, 403);
});

test("marking a show past makes it read-only", async () => {
  fresh();
  const u = await call(shows, { method: "POST", body: { ownerCode: "owner", update: { id: "nov", status: "past" } } });
  assert.equal(u.status, 200);
  const v = await call(vote, { method: "POST", body: { show: "nov", code: "band", voter: "Rich", votes: {} } });
  assert.equal(v.status, 409);
});

test("a song added to a show without lead labels gets no lead", async () => {
  fresh();
  await call(admin, { method: "POST", body: { show: "nov", ownerCode: "owner", settings: { leads: [] } } });
  await call(admin, { method: "POST", body: { show: "nov", ownerCode: "owner", add: [{ song: "Paranoid", artist: "Black Sabbath" }] } });
  const d = (await call(data, { query: { show: "nov" } })).json.data;
  assert.equal(d.rows.find((x) => x.k === "paranoid-blacksabbath").lead, "");
});
