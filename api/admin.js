import {
  readAll,
  writeSongs,
  writeTunings,
  writeGrid,
  writeSettings,
  forceValue,
  readBody,
  resolveShow,
  updateShow,
  readLibrary,
  upsertLibrary,
  SETTING_KEYS,
} from "./_sheets.js";
import { selectSet } from "./_selection.js";
import { songKey, keyboardValue } from "../setlist.js";
import { requireOwner, requireWritable } from "./_auth.js";
import {
  buildPayload, keyResolver, rosterOf, ok, fail, methodGuard, guarded, showParam,
} from "./_payload.js";

/**
 * Add / edit / remove songs, and set the manual running order.
 *
 * Gated on the owner code (OWNER_SECRET, or APP_SECRET where that is all that
 * is set). That is deliberately weak: it stops a bandmate deleting a row by
 * accident, and nothing more. It is not authentication and should never be
 * described as any. October's admin page still sends it as `key`.
 *
 * Body: {show, ownerCode|key, add:[{...}], update:[{key:'Song|Artist', ...}], remove:['Song|Artist'],
 *        order:[{key, pos}], clearOrder:true,
 *        force:[{key, value:'IN'|'OUT'|''}], maxSongs:20, lockSet:true|false,
 *        keyboard:[{key, value:'ESSENTIAL'|'ADDS'|'NONE'|''}], gigDate:'2026-10-24',
 *        settings:{showName, voters:[...], ...}}
 */
export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;
  return guarded(res, async () => {
    const body = await readBody(req);
    requireOwner(body);
    const show = await resolveShow(showParam(req, body));
    requireWritable(show);

    const state = await readAll(show);
    let songs = state.songs.map((s) => ({ ...s }));
    const result = { added: 0, updated: 0, removed: 0 };
    const touchedKeys = new Set();
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
      if (u.year !== undefined) s.year = String(u.year).trim();
      if (u.era !== undefined) s.era = String(u.era).trim();
      touchedKeys.add(s.k);
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

    // --- add, grouped under the matching section where one already exists.
    // A song the library already knows brings its facts with it: whatever the
    // form leaves blank is filled from the last show that played it.
    const library = (body.add || []).length ? await readLibrary() : {};
    for (const a of body.add || []) {
      if (!a.song || !a.artist) continue;
      const k = songKey(a.song, a.artist);
      if (songs.some((s) => s.k === k)) continue;      // never create a duplicate key
      const lib = library[k] || {};
      const given = (v) => v !== undefined && v !== null && String(v).trim() !== "";
      const tags = given(a.tags)
        ? (Array.isArray(a.tags) ? a.tags : String(a.tags).split(/[,;]\s*/).filter(Boolean))
        : lib.tags || [];
      const row = {
        k,
        section: a.section || "Added",
        song: String(a.song),
        artist: String(a.artist),
        // A band with no lead labels gets no lead, rather than a V1 it never asked for.
        lead: String(given(a.lead) ? a.lead : lib.lead || ((state.settings.leads || []).length ? "V1" : "")).toUpperCase(),
        len: given(a.length) ? String(a.length) : lib.len || "3:30",
        energy: Number(a.energy) || lib.energy || 0,
        tags,
        order: 0,
        keyboard: keyboardValue(given(a.keyboard) ? a.keyboard : lib.keyboard),
        year: String(given(a.year) ? a.year : lib.year || "").trim(),
        era: String(given(a.era) ? a.era : lib.era || "").trim(),
      };
      touchedKeys.add(k);
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
    if (touched) await writeSongs(show, songs);

    // Keep the library in step with what this show now says about each song
    // it added or edited, so the next show that plays it starts from here.
    // The library's own tempo estimate is kept; nothing else is touched.
    if (touchedKeys.size) {
      const lib = await readLibrary();
      await upsertLibrary(
        songs.filter((s) => touchedKeys.has(s.k)).map((s) => ({ ...s, bpm: (lib[s.k] || {}).bpm || 0 }))
      );
    }

    // Read back BEFORE writing tunings: that read is what creates the Tunings
    // row for a song added a moment ago, and writeTunings only ever fills in a
    // row that already exists. The other order silently dropped the tuning
    // typed on the admin page when the song was new.
    let fresh = await readAll(show);
    await writeTunings(tuningEdits);
    const tunings = { ...fresh.tunings, ...tuningEdits };

    // --- how many songs the set holds. 0 hands the decision back to the clock.
    if (body.maxSongs !== undefined) {
      const n = Math.max(0, Math.floor(Number(body.maxSongs) || 0));
      await writeSettings(show, { maxSongs: n });
      fresh = { ...fresh, settings: { ...fresh.settings, maxSongs: n } };
      result.maxSongs = n;
    }

    // --- when the show is. Bounds the availability calendar.
    if (body.gigDate !== undefined) {
      const d = String(body.gigDate || "").trim();
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return fail(res, 400, "gigDate must be YYYY-MM-DD, or empty to clear it.");
      }
      await writeSettings(show, { gigDate: d });
      await updateShow(show.id, { gigDate: d });
      fresh = { ...fresh, settings: { ...fresh.settings, gigDate: d } };
      result.gigDate = d;
    }

    // --- the show's own settings: who votes, who plays, the budget, the cap
    if (body.settings && typeof body.settings === "object") {
      const patch = validSettings(body.settings, fresh.settings);
      if (patch.error) return fail(res, 400, patch.error);
      await writeSettings(show, patch.values);
      fresh = { ...fresh, settings: { ...fresh.settings, ...patch.values } };
      result.settings = Object.keys(patch.values);
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
        const sel = selectSet(buildPayload({ ...fresh, tunings }).rows, rosterOf(fresh.settings),
          { settings: { ...fresh.settings, locked: false, lockedKeys: [] } });
        if (sel.blocked) {
          return fail(res, 409,
            "Cannot lock the set: some songs have an unreadable Length, so there is no set to freeze.");
        }
        lockedKeys = [...sel.inSet];
      }
      await writeSettings(show, { locked: lock, lockedKeys });
      fresh = { ...fresh, settings: { ...fresh.settings, locked: lock, lockedKeys } };
      result.locked = lock;
      result.lockedCount = lockedKeys.length;
    }

    try {
      await writeGrid(show, { ...fresh, tunings });
    } catch (e) {
      console.error("grid rewrite failed:", e.message);
    }
    return ok(res, { result, data: buildPayload({ ...fresh, tunings }) });
  });
}

const LIST_KEYS = ["voters", "band", "warnings", "leads", "eras"];
const NUMBER_KEYS = ["budgetSeconds", "gapSeconds", "maxPerArtist", "maxSongs"];
const TEXT_KEYS = ["showName", "occasion", "bandName", "owner"];
const CHOICE_KEYS = { tieBreak: ["energy", "shorter"], orderEngine: ["pacing", "curve"] };

/**
 * Only known keys, each cleaned to the type the reader expects. The band has
 * to be a subset of the voters: a player who cannot vote is a typo, not a
 * policy, and it is the commonest way a name ends up spelt two ways.
 */
export function validSettings(input, current) {
  const values = {};
  for (const [k, raw] of Object.entries(input)) {
    if (!SETTING_KEYS.includes(k)) continue;
    if (LIST_KEYS.includes(k)) {
      const list = (Array.isArray(raw) ? raw : String(raw).split(","))
        .map((x) => String(x).trim()).filter(Boolean);
      values[k] = [...new Set(list)];
    } else if (NUMBER_KEYS.includes(k)) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return { error: `${k} must be a number, 0 or more.` };
      values[k] = Math.floor(n);
    } else if (TEXT_KEYS.includes(k)) {
      values[k] = String(raw ?? "").trim().slice(0, 120);
    } else if (CHOICE_KEYS[k]) {
      if (!CHOICE_KEYS[k].includes(raw)) return { error: `${k} must be one of ${CHOICE_KEYS[k].join(", ")}.` };
      values[k] = raw;
    }
  }
  const voters = values.voters || current.voters || [];
  const band = values.band || current.band || [];
  const lower = new Set(voters.map((n) => n.toLowerCase()));
  const stray = band.filter((n) => !lower.has(n.toLowerCase()));
  if (stray.length) return { error: `Every player must also be a voter: ${stray.join(", ")}.` };
  return { values };
}
