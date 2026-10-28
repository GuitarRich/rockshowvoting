import { test } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.js";
import { makeFakeSheets } from "./fakeSheets.js";
import { twoShows } from "./nov.fixture.js";
import { setSheetsClient } from "../api/_sheets.js";
import { layoutSet } from "../selection.js";
import data from "../api/data.js";
import admin from "../api/admin.js";

/*
 * The setlist page applies a change to its own copy of the payload and
 * reworks the set itself before the save comes back. That only works if its
 * answer is the server's answer, so check the two agree change by change.
 */
const load = async (show) => (await call(data, { query: { show } })).json.data;
const save = async (show, body) => {
  const r = await call(admin, { method: "POST", body: { show, ownerCode: "owner", ...body } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
};
// What setlist.html's relayout() does.
function relayout(D) {
  const settings = { ...D.settings, maxSongs: D.set.maxSongs, locked: D.set.locked, lockedKeys: D.set.lockedKeys || [] };
  const { inSet, ...set } = layoutSet(D.rows, D.voters, settings);
  D.set = { ...D.set, ...set };
  return D;
}
const same = (page, server) => {
  assert.deepEqual(page.set.order, server.set.order);
  assert.equal(page.set.orderMode, server.set.orderMode);
  assert.equal(page.set.count, server.set.count);
  assert.equal(page.set.seconds, server.set.seconds);
  assert.deepEqual(page.rows.map((r) => [r.k, r.inSet, r.cut]), server.rows.map((r) => [r.k, r.inSet, r.cut]));
};

for (const show of ["oct", "nov"]) {
  test(`${show}: the page's own rework matches the server's`, async () => {
    setSheetsClient(makeFakeSheets(twoShows()));
    let D = await load(show);
    same(relayout(structuredClone(D)), D);

    // Force a cut song in, and a set song out.
    // October's whole ballot can fit, so fall back to any song for the forced-in one.
    const cut = D.rows.find((r) => !r.inSet) || D.rows[D.rows.length - 1];
    const kept = D.rows.find((r) => r.inSet && r.k !== cut.k);
    let page = structuredClone(D);
    page.rows.find((r) => r.k === cut.k).force = "IN";
    page.rows.find((r) => r.k === kept.k).force = "OUT";
    D = await save(show, { force: [{ key: cut.k, value: "IN" }, { key: kept.k, value: "OUT" }] });
    same(relayout(page), D);

    // Reorder by hand: swap the first two.
    page = structuredClone(D);
    const keys = [...D.set.order];
    [keys[0], keys[1]] = [keys[1], keys[0]];
    page.rows.forEach((r) => { r.order = keys.indexOf(r.k) + 1; });
    D = await save(show, { order: keys.map((k, i) => ({ key: k, pos: i + 1 })) });
    same(relayout(page), D);

    // A song count.
    page = structuredClone(D);
    page.set.maxSongs = 8;
    page.settings.maxSongs = 8;
    D = await save(show, { maxSongs: 8 });
    same(relayout(page), D);

    // Lock, then a vote that would otherwise move the set.
    page = structuredClone(D);
    page.set.locked = false; page.set.lockedKeys = [];
    relayout(page);
    page.set.lockedKeys = page.rows.filter((r) => r.inSet).map((r) => r.k);
    page.set.locked = true;
    D = await save(show, { lockSet: true });
    same(relayout(page), D);
    assert.deepEqual([...page.set.lockedKeys].sort(), [...D.set.lockedKeys].sort());
  });
}
