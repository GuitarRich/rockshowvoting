import { readAll, writeAvailability, readBody, resolveShow } from "./_sheets.js";
import { availabilityValue, isDayKey } from "../setlist.js";
import { requireBand, requireWritable } from "./_auth.js";
import { buildPayload, onList, ok, fail, methodGuard, guarded, showParam } from "./_payload.js";

/**
 * Save one person's availability. Body: {show, code, person, days:{'2026-10-03':'YES'}}.
 *
 * An empty string removes the day, taking it back to "hasn't said" — which the
 * calendar shows differently from NO, because an unanswered day is somebody to
 * chase and a NO is a fact to plan around.
 */
export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;
  return guarded(res, async () => {
    const body = await readBody(req);
    const show = await resolveShow(showParam(req, body));
    requireWritable(show);
    requireBand(show, body);

    const person = String(body.person || body.name || "").trim();
    if (!person) return fail(res, 400, "No name supplied.");
    const state = await readAll(show);
    const known = onList(state.settings.band, person);
    if (!known) {
      return fail(res, 400,
        `"${person}" is not in the band. If that is wrong, add the name to "band" on the show's Settings tab.`);
    }

    const days = { ...((state.availability[known] || {}).days || {}) };

    let written = 0;
    for (const [rawDay, rawValue] of Object.entries(body.days || {})) {
      const day = String(rawDay).trim();
      if (!isDayKey(day)) continue;
      const val = availabilityValue(rawValue);
      if (val === "") {
        if (days[day] !== undefined) delete days[day];
        written++;
        continue;
      }
      days[day] = val;
      written++;
    }

    await writeAvailability(show, { name: known, days, ts: Date.now(), version: body.version });
    return ok(res, { person: known, written, data: buildPayload(await readAll(show)) });
  });
}
