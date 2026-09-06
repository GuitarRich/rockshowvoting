import { readAll, writeLearner, writeGrid, readBody } from "./_sheets.js";
import { isLearnValue } from "../setlist.js";
import { buildPayload, keyResolver, ok, fail, methodGuard } from "./_payload.js";

/**
 * Save one person's practice status. Body: {person, learn:{'Song|Artist':'KNOW'}}.
 *
 * Unlike a vote this covers EVERY song, locked ones included — the locked
 * songs are the ones everybody definitely has to learn. Missing from the blob
 * means "hasn't said", which the page shows differently from "not started".
 */
export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;
  try {
    const body = await readBody(req);
    const person = String(body.person || body.name || body.voter || "").trim();
    if (!person) return fail(res, 400, "No name supplied.");

    const state = await readAll();
    const resolve = keyResolver(state.songs);
    const learn = { ...((state.learners[person] || {}).learn || {}) };

    let written = 0;
    for (const [raw, value] of Object.entries(body.learn || {})) {
      const song = resolve(raw);
      if (!song) continue;
      const val = String(value || "").trim().toUpperCase();
      if (val === "") {
        if (learn[song.k] !== undefined) delete learn[song.k];
        written++;
        continue;
      }
      if (!isLearnValue(val)) continue;
      learn[song.k] = val;
      written++;
    }

    await writeLearner({ name: person, learn, ts: Date.now(), version: body.version });
    const fresh = await readAll();
    try {
      await writeGrid(fresh.songs, fresh.voters, fresh.tunings, fresh.learners);
    } catch (e) {
      console.error("grid rewrite failed:", e.message);
    }
    return ok(res, { person, written, data: buildPayload(fresh) });
  } catch (e) {
    return fail(res, 500, e.message);
  }
}
