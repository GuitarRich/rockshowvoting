import {
  readShows, defaultShowId, appendShow, updateShow, ensureTabs, readAll, writeSongs,
  writeSettings, readBody, SETTING_KEYS,
} from "./_sheets.js";
import { requireOwner } from "./_auth.js";
import { ok, fail, methodGuard, guarded } from "./_payload.js";

const pub = (s) => ({
  id: s.id, name: s.name, gigDate: s.gigDate, status: s.status, requireBandCode: s.requireBandCode,
});

/**
 * The show registry.
 *
 *   GET                         { shows, defaultId }
 *   POST {ownerCode, create:{id, name, gigDate, copyFrom?}}
 *   POST {ownerCode, update:{id, name?, gigDate?, status?, requireBandCode?}}
 *
 * A new show gets its own prefixed tabs. `copyFrom` copies the songs and the
 * settings of another show — never its votes, practice marks or availability,
 * which belong to the people of that show.
 */
export default async function handler(req, res) {
  if (methodGuard(req, res, ["GET", "POST"])) return;
  return guarded(res, async () => {
    if (req.method === "GET") {
      const shows = await readShows();
      return ok(res, { shows: shows.map(pub), defaultId: defaultShowId(shows) });
    }
    const body = await readBody(req);
    requireOwner(body);
    const shows = await readShows();

    if (body.create) {
      const c = body.create;
      const id = String(c.id || "").trim().toLowerCase();
      if (!/^[a-z0-9-]{1,20}$/.test(id)) {
        return fail(res, 400, "Show id must be 1–20 lowercase letters, numbers or dashes.");
      }
      if (shows.some((s) => s.id === id)) return fail(res, 409, `There is already a show called "${id}".`);
      const gigDate = String(c.gigDate || "").trim();
      if (gigDate && !/^\d{4}-\d{2}-\d{2}$/.test(gigDate)) return fail(res, 400, "gigDate must be YYYY-MM-DD.");
      const show = {
        id, prefix: `${id}·`, name: String(c.name || id).trim().slice(0, 120), gigDate,
        status: "current", requireBandCode: c.requireBandCode !== false,
      };
      await ensureTabs(show);
      await appendShow(show);
      const settings = { showName: show.name, gigDate };
      if (c.copyFrom) {
        const from = shows.find((s) => s.id === String(c.copyFrom).toLowerCase());
        if (!from) return fail(res, 404, `No show called "${c.copyFrom}" to copy from.`);
        const src = await readAll(from);
        // Songs come over with their facts; the running order and any forcing
        // were decisions about the old show, so they start clear.
        await writeSongs(show, src.songs.map((s) => ({ ...s, order: 0, force: "" })));
        for (const k of SETTING_KEYS) {
          if (["locked", "lockedKeys", "gigDate", "showName"].includes(k)) continue;
          if (src.settings[k] !== undefined) settings[k] = src.settings[k];
        }
      }
      await writeSettings(show, settings);
      return ok(res, { show: pub(show) });
    }

    if (body.update) {
      const u = body.update;
      const id = String(u.id || "").trim().toLowerCase();
      const patch = {};
      if (u.name !== undefined) patch.name = String(u.name).trim().slice(0, 120);
      if (u.gigDate !== undefined) {
        const d = String(u.gigDate || "").trim();
        if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return fail(res, 400, "gigDate must be YYYY-MM-DD.");
        patch.gigDate = d;
      }
      if (u.status !== undefined) {
        if (!["current", "past"].includes(u.status)) return fail(res, 400, "status must be current or past.");
        patch.status = u.status;
      }
      if (u.requireBandCode !== undefined) patch.requireBandCode = !!u.requireBandCode;
      const next = await updateShow(id, patch);
      return ok(res, { show: pub(next) });
    }
    return fail(res, 400, "Nothing to do: send create or update.");
  });
}
