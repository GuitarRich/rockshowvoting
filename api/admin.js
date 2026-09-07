import {
  readAll,
  writeSongs,
  writeTunings,
  writeGrid,
  writeSettings,
  forceValue,
  readBody,
} from "./_sheets.js";
import { selectSet } from "./_selection.js";
import { songKey, keyboardValue } from "../setlist.js";
import { buildPayload, keyResolver, rosterOf, ok, fail, methodGuard } from "./_payload.js";

/**
 * Add / edit / remove songs, and set the manual running order.
 *
 * Gated on APP_SECRET. That is deliberately weak: it stops a bandmate deleting
 * a row by accident, and nothing more. It is not authentication and should
 * never be described as any.
 *
 * Body: {key, add:[{...}], update:[{key:'Song|Artist', ...}], remove:['Song|Artist'],
 *        order:[{key, pos}], clearOrder:true,
 *        force:[{key, value:'IN'|'OUT'|''}], maxSongs:20, lockSet:true|false,
 *        keyboard:[{key, value:'ESSENTIAL'|'ADDS'|'NONE'|''}]}
 */
export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;
  try {
    const body = await readBody(req);
    const secret = process.env.APP_SECRET;
    if (!secret) return fail(res, 500, "APP_SECRET is not set on the server.");
    if (String(body.key || "") !== secret) return fail(res, 403, "Wrong admin key.");

    const state = await readAll();
    let songs = state.songs.map((s) => ({ ...s }));
    const result = { added: 0, updated: 0, removed: 0 };
    const tuningEdits = {};

    // --- update in place. The key never changes, even on a rename, so the
    // votes and practice statuses already recorded against it survive.
    for (const u of body.update || []) {
      const s = keyResolver(songs)(u.key);
      if (!s) continue;
      if (u.section !== undefined) s.section = String(u.section);
      if (u.song !== undefined && u.song !== "") s.song = String(u.song);
      if (u.artist !== undefined && u.artist !== "") s.artist = String(u.artist);
      if (u.lead !== undefined) s.lead = String(u.lead || s.lead).toUpperCase();
      if (u.length !== undefined && u.length !== "") s.len = String(u.length);
      if (u.energy !== undefined) s.energy = Number(u.energy) || s.energy;
      if (u.tags !== undefined) {
        s.tags = Array.isArray(u.tags)
          ? u.tags
          : String(u.tags).split(/[,;]\s*/).filter(Boolean);
      }
      if (u.tuning !== undefined) tuningEdits[s.k] = String(u.tuning).trim();
      if (u.keyboard !== undefined) s.keyboard = keyboardValue(u.keyboard);
      result.updated++;
    }

    // --- remove
    if ((body.remove || []).length) {
      const doomed = new Set();
      const resolve = keyResolver(songs);
      for (const key of body.remove) {
        const s = resolve(key);
        if (s) doomed.add(s.k);
      }
      const before = songs.length;
      songs = songs.filter((s) => !doomed.has(s.k));
      result.removed = before - songs.length;
    }

    // --- add, grouped under the matching section where one already exists
    for (const a of body.add || []) {
      if (!a.song || !a.artist) continue;
      const k = songKey(a.song, a.artist);
      if (songs.some((s) => s.k === k)) continue;      // never create a duplicate key
      const row = {
        k,
        section: a.section || "Added",
        song: String(a.song),
        artist: String(a.artist),
        lead: String(a.lead || "V1").toUpperCase(),
        len: a.length || "3:30",
        energy: Number(a.energy) || 0,
        tags: Array.isArray(a.tags)
          ? a.tags
          : String(a.tags || "").split(/[,;]\s*/).filter(Boolean),
        order: 0,
        keyboard: keyboardValue(a.keyboard),
      };
      let at = -1;
      songs.forEach((s, i) => {
        if (s.section === row.section) at = i;
      });
      if (at >= 0) songs.splice(at + 1, 0, row);
      else songs.push(row);
      if (a.tuning) tuningEdits[k] = String(a.tuning).trim();
      result.added++;
    }

    // --- force a song in or out, overriding what it scored
    for (const f of body.force || []) {
      const s = keyResolver(songs)(f.key);
      if (!s) continue;
      s.force = forceValue(f.value);
      result.forced = (result.forced || 0) + 1;
    }

    // --- how much the keyboard matters, judged per song
    for (const kb of body.keyboard || []) {
      const s = keyResolver(songs)(kb.key);
      if (!s) continue;
      s.keyboard = keyboardValue(kb.value);
      result.keyboard = (result.keyboard || 0) + 1;
    }

    // --- manual running order, stored per song rather than by index so a song
    // that later drops out cannot shift everything below it.
    if (body.clearOrder) {
      songs.forEach((s) => {
        s.order = 0;
      });
      result.orderCleared = true;
    } else if ((body.order || []).length) {
      const resolve = keyResolver(songs);
      const pos = new Map();
      for (const o of body.order) {
        const s = resolve(o.key);
        if (s) pos.set(s.k, Number(o.pos) || 0);
      }
      songs.forEach((s) => {
        s.order = pos.get(s.k) || 0;
      });
      result.ordered = pos.size;
    }

    const touched =
      result.added || result.removed || result.updated || result.forced ||
      result.keyboard || result.orderCleared || result.ordered;
    if (touched) await writeSongs(songs);

    // Read back BEFORE writing tunings: that read is what creates the Tunings
    // row for a song added a moment ago, and writeTunings only ever fills in a
    // row that already exists. The other order silently dropped the tuning
    // typed on the admin page when the song was new.
    let fresh = await readAll();
    await writeTunings(tuningEdits);
    const tunings = { ...fresh.tunings, ...tuningEdits };

    // --- how many songs the set holds. 0 hands the decision back to the clock.
    if (body.maxSongs !== undefined) {
      const n = Math.max(0, Math.floor(Number(body.maxSongs) || 0));
      await writeSettings({ maxSongs: n });
      fresh = { ...fresh, settings: { ...fresh.settings, maxSongs: n } };
      result.maxSongs = n;
    }

    // --- lock: snapshot exactly the songs that are in the set right now, so
    // the list stops moving as votes come in. Unlocking throws the snapshot
    // away and hands the set back to the vote.
    if (body.lockSet !== undefined) {
      const lock = !!body.lockSet;
      let lockedKeys = [];
      if (lock) {
        // Take the snapshot from an unlocked run, or re-locking would just
        // freeze the frozen list and a stale one could never be refreshed.
        const sel = selectSet(buildPayload({ ...fresh, tunings }).rows, rosterOf(),
          { settings: { ...fresh.settings, locked: false, lockedKeys: [] } });
        if (sel.blocked) {
          return fail(res, 409,
            "Cannot lock the set: some songs have an unreadable Length, so there is no set to freeze.");
        }
        lockedKeys = [...sel.inSet];
      }
      await writeSettings({ locked: lock, lockedKeys });
      fresh = { ...fresh, settings: { ...fresh.settings, locked: lock, lockedKeys } };
      result.locked = lock;
      result.lockedCount = lockedKeys.length;
    }

    try {
      await writeGrid(fresh.songs, fresh.voters, tunings, fresh.learners);
    } catch (e) {
      console.error("grid rewrite failed:", e.message);
    }
    return ok(res, { result, data: buildPayload({ ...fresh, tunings }) });
  } catch (e) {
    return fail(res, 500, e.message);
  }
}
