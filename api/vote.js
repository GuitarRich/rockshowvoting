import { readAll, writeVoter, writeGrid, readBody, resolveShow } from "./_sheets.js";
import { isVoteValue } from "../setlist.js";
import { requireBand, requireOwner, requireWritable } from "./_auth.js";
import {
  buildPayload, keyResolver, onList, ok, fail, methodGuard, guarded, showParam,
} from "./_payload.js";

/**
 * Save one person's votes. Body: {show, code, voter, votes:{'Song|Artist':'MUST', ...}}.
 * An empty string clears a vote — the page sends every song it knows about,
 * so a cleared button has to travel as a value rather than an absence.
 */
export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;
  return guarded(res, async () => {
    const body = await readBody(req);
    const show = await resolveShow(showParam(req, body));
    requireWritable(show);
    requireBand(show, body);
    // Pooling writes someone else's ballot from a pasted code or CSV. That is
    // the owner's job, so it needs the owner code as well.
    if (body.pool) requireOwner(body);

    const voter = String(body.voter || body.name || "").trim();
    if (!voter) return fail(res, 400, "No voter name supplied.");
    const state = await readAll(show);
    const known = onList(state.settings.voters, voter);
    if (!known) {
      return fail(res, 400,
        `"${voter}" is not on the voting list. If that is wrong, add the name to "voters" on the show's Settings tab.`);
    }

    const resolve = keyResolver(state.songs);
    const votes = { ...((state.voters[known] || {}).votes || {}) };

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

    await writeVoter(show, { name: known, votes, ts: Date.now(), version: body.version });
    const fresh = await readAll(show);
    // The Grid tab is derived and disposable, so a formatting failure must
    // never fail a vote that has already been saved.
    try {
      await writeGrid(show, fresh);
    } catch (e) {
      console.error("grid rewrite failed:", e.message);
    }
    return ok(res, { voter: known, written, data: buildPayload(fresh) });
  });
}
