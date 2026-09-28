/**
 * October is live until its gig. Whatever else changes, a request with no
 * `show` must answer exactly as the October app did when this fixture was
 * captured (scripts/capture-oct-payload.js). New fields are allowed; a
 * changed or missing field is a regression.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { call } from "./helpers.js";
import { makeFakeSheets } from "./fakeSheets.js";
import { setSheetsClient } from "../api/_sheets.js";
import data from "../api/data.js";
import vote from "../api/vote.js";

const payload = JSON.parse(fs.readFileSync(new URL("./fixtures/oct-payload.json", import.meta.url)));
const sheet = JSON.parse(fs.readFileSync(new URL("./fixtures/oct-sheet.json", import.meta.url)));

/** Every field in `want` must be deep-equal in `got`; extra fields in `got` are fine. */
function assertSuperset(got, want, at = "data") {
  if (Array.isArray(want)) {
    assert.ok(Array.isArray(got), `${at} should be an array`);
    assert.equal(got.length, want.length, `${at} length`);
    want.forEach((w, i) => assertSuperset(got[i], w, `${at}[${i}]`));
  } else if (want && typeof want === "object") {
    assert.ok(got && typeof got === "object", `${at} should be an object`);
    for (const k of Object.keys(want)) assertSuperset(got[k], want[k], `${at}.${k}`);
  } else {
    assert.deepEqual(got, want, at);
  }
}

const fresh = () => {
  const fake = makeFakeSheets(structuredClone(sheet));
  setSheetsClient(fake);
  return fake;
};

test("october: /api/data with no show matches the captured payload", async () => {
  fresh();
  const r = await call(data, { method: "GET" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assertSuperset(r.json.data, payload);
});

test("october: a vote needs no band code and lands on the unprefixed Votes tab", async () => {
  const fake = fresh();
  const song = payload.rows.find((r) => !/^LOCKED/i.test(r.section));
  const r = await call(vote, { method: "POST", body: { voter: "Rich", votes: { [song.k]: "YES" } } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const rows = fake.snapshot().Votes;
  const rich = rows.find((x) => x[0] === "Rich");
  assert.equal(JSON.parse(rich[4])[song.k], "YES");
});
