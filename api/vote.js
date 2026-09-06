import { readAll, writeVoter, writeGrid, readBody } from "./_sheets.js";
import { isVoteValue } from "../setlist.js";
import { buildPayload, keyResolver, ok, fail, methodGuard } from "./_payload.js";

/**
 * Save one person's votes. Body: {voter, votes:{'Song|Artist':'MUST', ...}}.
 * An empty string clears a vote — the page sends every song it knows about,
 * so a cleared button has to travel as a value rather than an absence.
 */
export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;
  try {
    const body = await readBody(req);
    const voter = String(body.voter || body.name || "").trim();
    if (!voter) return fail(res, 400, "No voter name supplied.");

    const state = await readAll();
    const resolve = keyResolver(state.songs);
    const votes = { ...((state.voters[voter] || {}).votes || {}) };

    let written = 0;
    for (const [raw, value] of Object.entries(body.votes || {})) {
      const song = resolve(raw);
      if (!song) continue;
      // Locked songs are not up for vote; the pick-ONE sections are, because
      // that is how the band chooses which one of them gets played.
      if (/^LOCKED/i.test(song.section) && !/pick ONE/i.test(song.section)) continue;
      const val = String(value || "").trim().toUpperCase();
      if (val === "") {
        if (votes[song.k] !== undefined) delete votes[song.k];
        written++;
        continue;
      }
      if (!isVoteValue(val)) continue;
      votes[song.k] = val;
      written++;
    }

    await writeVoter({ name: voter, votes, ts: Date.now(), version: body.version });
    const fresh = await readAll();
    // The Grid tab is derived and disposable, so a formatting failure must
    // never fail a vote that has already been saved.
    try {
      await writeGrid(fresh.songs, fresh.voters, fresh.tunings, fresh.learners);
    } catch (e) {
      console.error("grid rewrite failed:", e.message);
    }
    return ok(res, { voter, written, data: buildPayload(fresh) });
  } catch (e) {
    return fail(res, 500, e.message);
  }
}
