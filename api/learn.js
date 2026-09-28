import { readAll, writeLearner, writeGrid, readBody, resolveShow } from "./_sheets.js";
import { isLearnValue } from "../setlist.js";
import { requireBand, requireWritable } from "./_auth.js";
import {
  buildPayload, keyResolver, onList, ok, fail, methodGuard, guarded, showParam,
} from "./_payload.js";

/**
 * Save one person's practice status. Body: {show, code, person, learn:{'Song|Artist':'KNOW'}}.
 *
 * Unlike a vote this covers EVERY song, locked ones included — the locked
 * songs are the ones everybody definitely has to learn. Missing from the blob
 * means "hasn't said", which the page shows differently from "not started".
 */
export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;
  return guarded(res, async () => {
    const body = await readBody(req);
    const show = await resolveShow(showParam(req, body));
    requireWritable(show);
    requireBand(show, body);

    const person = String(body.person || body.name || body.voter || "").trim();
    if (!person) return fail(res, 400, "No name supplied.");
    const state = await readAll(show);
    // Only the band practises: voting on the setlist does not put you on stage.
    const known = onList(state.settings.band, person);
    if (!known) {
      return fail(res, 400,
        `"${person}" is not in the band, so there is nothing to track. If that is wrong, add the name to "band" on the show's Settings tab.`);
    }

    const resolve = keyResolver(state.songs);
    const learn = { ...((state.learners[known] || {}).learn || {}) };

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

    await writeLearner(show, { name: known, learn, ts: Date.now(), version: body.version });
    const fresh = await readAll(show);
    try {
      await writeGrid(show, fresh);
    } catch (e) {
      console.error("grid rewrite failed:", e.message);
    }
    return ok(res, { person: known, written, data: buildPayload(fresh) });
  });
}
