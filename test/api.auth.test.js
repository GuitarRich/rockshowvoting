import { test } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.js";
import { makeFakeSheets } from "./fakeSheets.js";
import { twoShows } from "./nov.fixture.js";
import { setSheetsClient } from "../api/_sheets.js";
import vote from "../api/vote.js";
import admin from "../api/admin.js";

const fresh = (opts) => {
  const fake = makeFakeSheets(twoShows(opts));
  setSheetsClient(fake);
  return fake;
};
const voteFor = (show, extra = {}) =>
  call(vote, { method: "POST", body: { show, voter: "Rich", votes: {}, ...extra } });

test("October needs no band code", async () => {
  fresh();
  assert.equal((await voteFor("oct")).status, 200);
});

test("November needs the band code", async () => {
  fresh();
  assert.equal((await voteFor("nov")).status, 401);
  assert.equal((await voteFor("nov", { code: "wrong" })).status, 401);
  assert.equal((await voteFor("nov", { code: "band" })).status, 200);
  assert.equal((await voteFor("nov", { code: ' "band" ' })).status, 200, "quotes and spaces are stripped");
});

test("admin takes the owner code as ownerCode or as October's `key`", async () => {
  fresh();
  const send = (body) => call(admin, { method: "POST", body: { show: "oct", ...body } });
  assert.equal((await send({ key: "owner" })).status, 200);
  assert.equal((await send({ ownerCode: "owner" })).status, 200);
  assert.equal((await send({ ownerCode: "band" })).status, 403);
  assert.equal((await send({})).status, 403);
});

test("typing the owner's name grants nothing", async () => {
  fresh();
  const r = await call(admin, { method: "POST", body: { show: "nov", code: "band", voter: "Rich", name: "Rich", maxSongs: 5 } });
  assert.equal(r.status, 403);
});

test("APP_SECRET still works when OWNER_SECRET is unset", async () => {
  fresh();
  const was = process.env.OWNER_SECRET;
  delete process.env.OWNER_SECRET;
  process.env.APP_SECRET = "legacy";
  try {
    const r = await call(admin, { method: "POST", body: { key: "legacy" } });
    assert.equal(r.status, 200);
  } finally {
    process.env.OWNER_SECRET = was;
    delete process.env.APP_SECRET;
  }
});

test("a past show refuses every write", async () => {
  fresh({ novStatus: "past" });
  assert.equal((await voteFor("nov", { code: "band" })).status, 409);
  const r = await call(admin, { method: "POST", body: { show: "nov", ownerCode: "owner", maxSongs: 4 } });
  assert.equal(r.status, 409);
});

test("settings: the band has to be a subset of the voters", async () => {
  fresh();
  const bad = await call(admin, {
    method: "POST",
    body: { show: "nov", ownerCode: "owner", settings: { band: ["Rich", "Zed"] } },
  });
  assert.equal(bad.status, 400);
  const good = await call(admin, {
    method: "POST",
    body: { show: "nov", ownerCode: "owner", settings: { voters: ["Rich", "Joel", "Anders", "Pete", "Zed"], band: ["Rich", "Zed"], maxPerArtist: 2 } },
  });
  assert.equal(good.status, 200, JSON.stringify(good.json));
  assert.deepEqual(good.json.data.band, ["Rich", "Zed"]);
  assert.equal(good.json.data.settings.maxPerArtist, 2);
});
