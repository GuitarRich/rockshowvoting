import { readAll, writeAvailability, readBody } from "./_sheets.js";
import { availabilityValue, isDayKey, BAND } from "../setlist.js";
import { buildPayload, ok, fail, methodGuard } from "./_payload.js";

/**
 * Save one person's availability. Body: {person, days:{'2026-10-03':'YES'}}.
 *
 * An empty string removes the day, taking it back to "hasn't said" — which the
 * calendar shows differently from NO, because an unanswered day is somebody to
 * chase and a NO is a fact to plan around.
 */
export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;
  try {
    const body = await readBody(req);
    const person = String(body.person || body.name || "").trim();
    if (!person) return fail(res, 400, "No name supplied.");
    const known = BAND.find((n) => n.toLowerCase() === person.toLowerCase());
    if (!known) {
      return fail(res, 400,
        `"${person}" is not in the band. If that is wrong, add the name to BAND in setlist.js.`);
    }

    const state = await readAll();
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

    await writeAvailability({ name: known, days, ts: Date.now(), version: body.version });
    return ok(res, { person: known, written, data: buildPayload(await readAll()) });
  } catch (e) {
    return fail(res, 500, e.message);
  }
}
