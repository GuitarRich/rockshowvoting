import { test } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.js";
import { makeFakeSheets } from "./fakeSheets.js";
import { twoShows } from "./nov.fixture.js";
import { setSheetsClient, defaultShowId, readShows } from "../api/_sheets.js";
import data from "../api/data.js";
import vote from "../api/vote.js";
import learn from "../api/learn.js";
import availability from "../api/availability.js";

const fresh = (opts) => {
  const fake = makeFakeSheets(twoShows(opts));
  setSheetsClient(fake);
  return fake;
};
const row = (snap, tab, name) => (snap[tab] || []).find((r) => r[0] === name);

test("no show reads October's unprefixed tabs", async () => {
  fresh();
  const r = await call(data, {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data.rows.map((x) => x.song), ["Jump", "Creep"]);
  assert.equal(r.json.data.show.id, "oct");
});

test("show=nov reads the nov· tabs and November's settings", async () => {
  fresh();
  const r = await call(data, { query: { show: "nov" } });
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.equal(d.rows.length, 4);
  assert.deepEqual(d.voters, ["Rich", "Joel", "Anders", "Pete"]);
  assert.equal(d.show.name, "Bun's & Roses");
  assert.equal(d.show.requireBandCode, true);
  assert.equal(d.set.maxSongs, 3);
  assert.equal(d.set.count, 3);
  assert.equal(d.set.order.length, 3);
  assert.equal(d.rows[0].year, "1978");
});

test("a November vote lands on nov·Votes only", async () => {
  const fake = fresh();
  const r = await call(vote, {
    method: "POST",
    body: { show: "nov", code: "band", voter: "joel", votes: { "riffraff-acdc": "MUST" } },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const snap = fake.snapshot();
  const joel = row(snap, "nov·Votes", "Joel");
  assert.ok(joel, "stored under the list's spelling");
  assert.equal(JSON.parse(joel[4])["riffraff-acdc"], "MUST");
  assert.equal(snap.Votes.length, 1, "October's Votes tab untouched");
});

test("November refuses a voter who is not on its list", async () => {
  fresh();
  const r = await call(vote, {
    method: "POST",
    body: { show: "nov", code: "band", voter: "Ashley", votes: {} },
  });
  assert.equal(r.status, 400);
});

test("an empty string clears a vote", async () => {
  const fake = fresh();
  const send = (v) => call(vote, {
    method: "POST",
    body: { show: "nov", code: "band", voter: "Rich", votes: { "kiss-prince": v } },
  });
  await send("YES");
  await send("");
  const rich = row(fake.snapshot(), "nov·Votes", "Rich");
  assert.deepEqual(JSON.parse(rich[4]), {});
});

test("votes on LOCKED songs are ignored", async () => {
  const fake = fresh();
  await call(vote, { method: "POST", body: { voter: "Rich", votes: { "creep-radiohead": "NO", "jump-vanhalen": "YES" } } });
  const rich = row(fake.snapshot(), "Votes", "Rich");
  assert.deepEqual(JSON.parse(rich[4]), { "jump-vanhalen": "YES" });
});

test("November learn accepts only its band, and only the saver's row changes", async () => {
  const fake = fresh();
  const bad = await call(learn, { method: "POST", body: { show: "nov", code: "band", person: "Isaac", learn: {} } });
  assert.equal(bad.status, 400);
  const noCode = await call(learn, { method: "POST", body: { show: "nov", person: "Pete", learn: {} } });
  assert.equal(noCode.status, 401);
  await call(learn, { method: "POST", body: { show: "nov", code: "band", person: "Pete", learn: { "kiss-prince": "KNOW" } } });
  await call(learn, { method: "POST", body: { show: "nov", code: "band", person: "Joel", learn: { "kiss-prince": "IN PROGRESS" } } });
  const snap = fake.snapshot();
  assert.equal(JSON.parse(row(snap, "nov·Learning", "Pete")[4])["kiss-prince"], "KNOW");
  assert.equal(JSON.parse(row(snap, "nov·Learning", "Joel")[4])["kiss-prince"], "IN PROGRESS");
});

test("availability for November goes to nov·Availability and skips bad days", async () => {
  const fake = fresh();
  const r = await call(availability, {
    method: "POST",
    body: { show: "nov", code: "band", person: "Anders", days: { "2026-11-01": "YES", "nope": "YES" } },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const snap = fake.snapshot();
  assert.deepEqual(JSON.parse(row(snap, "nov·Availability", "Anders")[4]), { "2026-11-01": "YES" });
  assert.equal(snap.Availability.length, 1);
});

test("an unknown show is a 404", async () => {
  fresh();
  const r = await call(data, { query: { show: "dec" } });
  assert.equal(r.status, 404);
});

test("the default show is the soonest upcoming current one", async () => {
  fresh();
  const shows = await readShows();
  assert.equal(defaultShowId(shows, "2026-09-28"), "oct");
  assert.equal(defaultShowId(shows, "2026-10-25"), "nov");
  assert.equal(defaultShowId(shows, "2026-12-01"), "nov");
});

test("a sheet with no Shows tab gains one, seeded with October", async () => {
  const fake = makeFakeSheets({ Settings: [["Key", "Value"], ["gigDate", "2026-10-24"]] });
  setSheetsClient(fake);
  const shows = await readShows();
  assert.equal(shows.length, 1);
  assert.equal(shows[0].id, "oct");
  assert.equal(shows[0].gigDate, "2026-10-24");
  assert.deepEqual(fake.snapshot().Shows[1], ["oct", "", "October Anniversary Show", "2026-10-24", "current", "FALSE"]);
});
