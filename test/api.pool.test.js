import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { call } from "./helpers.js";
import { makeFakeSheets } from "./fakeSheets.js";
import { twoShows } from "./nov.fixture.js";
import { setSheetsClient } from "../api/_sheets.js";
import vote from "../api/vote.js";
import health from "../api/health.js";
import { mkCode, rdCode, readVotesCSV, voteValue } from "../codes.js";
import { songKey } from "../setlist.js";

const { tracks } = JSON.parse(fs.readFileSync(new URL("../scripts/fixtures/bandvote-tracks-v32.json", import.meta.url)));
const fresh = () => setSheetsClient(makeFakeSheets(twoShows()));

test("pooling someone else's votes needs the owner code", async () => {
  fresh();
  const body = { show: "nov", code: "band", voter: "Pete", votes: { "kiss-prince": "YES" }, pool: true };
  assert.equal((await call(vote, { method: "POST", body })).status, 403);
  assert.equal((await call(vote, { method: "POST", body: { ...body, ownerCode: "owner" } })).status, 200);
});

test("RS1 codes round-trip", () => {
  const code = mkCode("nov", "Joel", { "kiss-prince": "MUST", "freak-silverchair": "NO", "x-y": "X" });
  assert.deepEqual(rdCode(code), { show: "nov", name: "Joel", votes: { "kiss-prince": "MUST", "freak-silverchair": "NO", "x-y": "X" } });
});

test("Band Vote BR2 and BR1 codes decode through the frozen catalog", () => {
  const br2 = rdCode("BR2-Rich~3.0|gloria-them^Gloria^Them^158^1^4^^|gloria-them:2", tracks);
  assert.equal(br2.name, "Rich");
  assert.equal(br2.votes[songKey(tracks[0].name, tracks[0].artist)], "MUST");
  assert.equal(br2.votes[songKey(tracks[2].name, tracks[2].artist)], "NO");
  assert.equal(br2.votes[songKey(tracks[1].name, tracks[1].artist)], undefined);
  assert.equal(br2.votes["gloria-them"], "YES");
  const br1 = rdCode("BR1-Pete~.1", tracks);
  assert.deepEqual(br1.votes, { [songKey(tracks[1].name, tracks[1].artist)]: "MAYBE" });
  assert.equal(rdCode("nonsense"), null);
});

test("vote CSVs read words, letters and 0–3, and skip unknown songs", () => {
  const csv = 'Song,Artist,Year,Rich,Joel,Total\nKiss,Prince,1986,3,YES,8\n"Freak",Silverchair,,N,\nNope,Nobody,,3,3,\n';
  const r = readVotesCSV(csv, new Set(["kiss-prince", "freak-silverchair"]));
  assert.deepEqual(r.byName, { Rich: { "kiss-prince": "MUST", "freak-silverchair": "NO" }, Joel: { "kiss-prince": "YES" } });
  assert.equal(r.unknown, 1);
  assert.equal(voteValue("pass"), "NO");
});

test("health lists every show's tabs and the library", async () => {
  fresh();
  const r = await call(health, {});
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.shows.map((s) => s.id), ["oct", "nov"]);
  assert.ok(r.json.shows[1].tabs.includes("nov·Votes"));
  assert.ok(r.json.libraryTabs.includes("Lyrics"));
  assert.equal(r.json.env.BAND_SECRET, true);
});
