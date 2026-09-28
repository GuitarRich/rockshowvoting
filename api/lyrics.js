import {
  readAll, readLyrics, writeLyric, addBlankLyricRows, readBody, resolveShow,
} from "./_sheets.js";
import { requireBand, requireWritable } from "./_auth.js";
import { buildPayload, keyResolver, ok, fail, methodGuard, guarded, showParam } from "./_payload.js";

/**
 * The words. Lyrics belong to the song, not the show, so they live on the
 * shared Lyrics tab: words pasted for November are there for any later show
 * that plays the same song.
 *
 *   GET  ?show=&all=1        { lyrics: {key: text} } for the set, or every song
 *   POST {show, code, key, lyrics}   save one song's words
 *   POST {show, code, addBlankRows:true}   a blank row per set song lacking one
 *
 * Nothing is fetched from a lyrics site. The band pastes them; the sheet is
 * the only source.
 */
export default async function handler(req, res) {
  if (methodGuard(req, res, ["GET", "POST"])) return;
  return guarded(res, async () => {
    if (req.method === "GET") {
      const show = await resolveShow(showParam(req));
      const data = buildPayload(await readAll(show));
      const all = /^(1|true|yes)$/i.test(String((req.query && req.query.all) || ""));
      const keys = data.rows.filter((r) => all || r.inSet).map((r) => r.k);
      return ok(res, { lyrics: await readLyrics(keys) });
    }

    const body = await readBody(req);
    const show = await resolveShow(showParam(req, body));
    requireWritable(show);
    requireBand(show, body);
    const state = await readAll(show);

    if (body.addBlankRows) {
      const inSet = new Set(buildPayload(state).rows.filter((r) => r.inSet).map((r) => r.k));
      const added = await addBlankLyricRows(state.songs.filter((s) => inSet.has(s.k)));
      return ok(res, { added });
    }

    const song = keyResolver(state.songs)(body.key);
    if (!song) return fail(res, 404, "No such song in this show.");
    await writeLyric({ key: song.k, song: song.song, artist: song.artist, lyrics: body.lyrics });
    return ok(res, { key: song.k, saved: true });
  });
}
