import { readAll, writeTempo, readBody, resolveShow } from "./_sheets.js";
import { requireBand, requireWritable } from "./_auth.js";
import { buildPayload, keyResolver, ok, fail, methodGuard, guarded, showParam } from "./_payload.js";

/**
 * Save one song's click tempo. Body: {show, code, key, bpm, beats}.
 *
 * Tempos are per song, on the shared Tempos tab. A cleared BPM cell falls back
 * to the library's estimate rather than meaning "no tempo": a click cannot run
 * without a number.
 */
export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;
  return guarded(res, async () => {
    const body = await readBody(req);
    const show = await resolveShow(showParam(req, body));
    requireWritable(show);

    const bpm = Number(body.bpm);
    const beats = Number(body.beats ?? 4);
    if (!Number.isInteger(bpm) || bpm < 30 || bpm > 300) {
      return fail(res, 400, "BPM must be a whole number from 30 to 300.");
    }
    if (!Number.isInteger(beats) || beats < 1 || beats > 12) {
      return fail(res, 400, "Beats per bar must be a whole number from 1 to 12.");
    }
    const state = await readAll(show);
    requireBand(show, body, state.settings);
    const song = keyResolver(state.songs)(body.key);
    if (!song) return fail(res, 404, "No such song in this show.");
    await writeTempo({ key: song.k, song: song.song, artist: song.artist, bpm, beats });
    const row = buildPayload(await readAll(show)).rows.find((r) => r.k === song.k);
    return ok(res, { key: song.k, bpm: row.bpm, beats: row.beats, bpmSource: row.bpmSource });
  });
}
