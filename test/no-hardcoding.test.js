/**
 * The pages every show uses must not carry one show's name, people or
 * numbers. (October's original index.html, results.html, learn.html and
 * availability.html are exempt until they retire after its gig.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SHARED = ["vote.html", "setlist.html", "lyrics.html", "click.html", "admin.html", "store.js"];
const BANNED = /October|Anniversary|Bun's|BUN'S|Bun&#39;s|Creed|Nickelback|90:00|two per band|\bJoel\b|\bAnders\b|\bAshley\b/;

for (const f of SHARED) {
  test(`${f} carries no show-specific text`, () => {
    const lines = fs.readFileSync(new URL("../" + f, import.meta.url), "utf8").split("\n");
    const hits = lines
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => BANNED.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
    assert.deepEqual(hits, []);
  });
}
