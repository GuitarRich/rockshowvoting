/**
 * Band Vote → this app, as pure functions. No I/O here: the migration script
 * reads both sheets, hands the rows in, and writes what comes back — so every
 * mapping below is tested against fixtures before it goes near a real sheet.
 *
 * Band Vote keyed its 73 built-in songs by list position (b0..b72) and its
 * added songs by the same name-artist slug this app uses everywhere. The
 * frozen v32 catalog (scripts/fixtures/bandvote-tracks-v32.json) is the only
 * link between a position and a song, so it is never regenerated.
 */
import { songKey } from "../../setlist.js";
import { libraryRow, songRow } from "../../api/_sheets.js";

export const NOV_BAND = ["Rich", "Joel", "Anders", "Pete"];
export const ERA_LABELS = { 1: "70s/80s", 2: "90s+" };

const VOTE_MAP = { 3: "MUST", 2: "YES", 1: "MAYBE", 0: "NO" };
export function mapVote(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Object.prototype.hasOwnProperty.call(VOTE_MAP, n) ? VOTE_MAP[n] : null;
}

const PROGRESS_MAP = {
  "know-it": "KNOW", "know-song": "KNOW", known: "KNOW", know: "KNOW",
  "in-progress": "IN PROGRESS", progress: "IN PROGRESS", wip: "IN PROGRESS",
  "not-started": "NOT STARTED",
};
export function mapProgress(v) {
  const s = String(v ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  return PROGRESS_MAP[s] || null;
}

export function mapState(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "in" ? "IN" : s === "out" ? "OUT" : "";
}

export function secsToMmss(n) {
  const s = Math.max(0, Math.round(Number(n) || 0));
  return s ? Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") : "";
}

/** Added songs as Band Vote's readAll saw them. */
export function parseAdded(rows) {
  return (rows || [])
    .filter((r) => r[0] && r[1])
    .map((r) => ({
      k: String(r[0]).trim(),
      name: String(r[1]).trim(),
      artist: String(r[2] || "").trim(),
      seconds: Number(r[3]) || 210,
      era: Number(r[4]) === 2 ? 2 : 1,
      energy: Number(r[5]) > 0 ? Number(r[5]) : 0,
      tags: String(r[6] || ""),
      lead: String(r[7] || ""),
    }))
    .sort((a, b) => (a.k < b.k ? -1 : 1));
}

/** Every Band Vote song in Band Vote's own order: built-ins, then added by key. */
export function bandVoteSongs(tracks, added) {
  return [
    ...tracks.map((t) => ({ ...t, bvKey: "b" + t.i, added: false })),
    ...added.map((a) => ({ ...a, bvKey: a.k, bpm: 0, year: "", added: true })),
  ];
}

/** b<i> or an added key → this app's songKey. */
export function keyMap(tracks, added) {
  const m = new Map();
  for (const s of bandVoteSongs(tracks, added)) m.set(s.bvKey, songKey(s.name, s.artist));
  return m;
}

/**
 * Rows that carry Key, Title and Artist (Setlist, Progress) must agree with
 * the key map. If they don't, the frozen catalog and the live sheet disagree
 * about which song a position is, and nothing should be written.
 */
export function crossCheck(rows, map) {
  const bad = [];
  for (const r of rows || []) {
    const k = String(r[0] || "").trim();
    if (!k || !r[1]) continue;
    const want = songKey(r[1], r[2]);
    const got = map.get(k);
    if (got && got !== want) bad.push(`${k}: catalog says ${got}, sheet row says ${want} ("${r[1]}")`);
  }
  if (bad.length) throw new Error("Key cross-check failed:\n  " + bad.join("\n  "));
}

const cleanTags = (t) =>
  String(t || "").split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);

/**
 * Everything the nov· tabs and the library tabs need.
 *
 * source: {
 *   tracks, addedRows, voteRows, setlistRows, progressRows (header included),
 *   settingsRows, lyricsRows, tempoRows, tuningRows,
 *   existing: { tunings:{k:v}, lyrics:{k:text}, tempos:{k:{bpm,beats}}, library:Set }
 *   gigDate, occasion
 * }
 */
export function buildNovTabs(source) {
  const report = { unmapped: [], clashes: [], notes: [] };
  const added = parseAdded(source.addedRows);
  const map = keyMap(source.tracks, added);
  crossCheck(source.setlistRows, map);
  crossCheck((source.progressRows || []).slice(1), map);
  const to = (bvKey) => {
    const k = map.get(String(bvKey).trim());
    if (!k) report.unmapped.push(String(bvKey));
    return k || null;
  };

  // A song can exist twice in Band Vote: added by hand, then later made a
  // built-in (You Really Got Me). Both copies map to the same key here, so
  // they merge into one song; wherever only one copy carries a vote, a state
  // or a position, that one wins, and a real disagreement is reported.
  const dupes = new Map();
  for (const s of bandVoteSongs(source.tracks, added)) {
    const k = songKey(s.name, s.artist);
    dupes.set(k, [...(dupes.get(k) || []), s.bvKey]);
  }
  for (const [k, keys] of dupes) {
    if (keys.length > 1) report.notes.push(`${keys.join(" + ")} are the same song (${k}); merged`);
  }

  // --- set state: forced in/out and the manual running order
  const force = {};
  const order = {};
  for (const r of source.setlistRows || []) {
    const k = to(r[0]);
    if (!k) continue;
    const st = mapState(r[3]);
    if (st) {
      if (force[k] && force[k] !== st) report.clashes.push(`Set state ${k}: ${force[k]} vs ${st}, kept ${force[k]}`);
      else force[k] = st;
    }
    const pos = Number(r[4]);
    if (pos > 0 && !order[k]) order[k] = pos;
  }
  // Positions are re-numbered 1..n in the saved order, so gaps and ties in
  // the source cannot collide.
  Object.entries(order)
    .sort((a, b) => a[1] - b[1])
    .forEach(([k], i) => {
      order[k] = i + 1;
    });

  // --- songs, one per key: the built-in copy's facts win over an added copy
  const seen = new Set();
  const songs = bandVoteSongs(source.tracks, added).filter((s) => {
    const k = songKey(s.name, s.artist);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((s) => {
    const k = songKey(s.name, s.artist);
    return {
      k,
      section: ERA_LABELS[s.era] || "",
      song: s.name,
      artist: s.artist,
      lead: String(s.lead || "").toUpperCase(),
      len: secsToMmss(s.seconds),
      energy: Number(s.energy) || 0,
      tags: cleanTags(s.tags),
      order: order[k] || 0,
      force: force[k] || "",
      keyboard: "",
      year: s.year ? String(s.year) : "",
      era: ERA_LABELS[s.era] || "",
      bpm: Number(s.bpm) || 0,
      added: s.added,
    };
  });

  // --- votes: one row per person, values remapped, keys remapped
  const voteRows = [];
  const voteCounts = {};
  for (const r of source.voteRows || []) {
    const name = String(r[0] || "").trim();
    if (!name) continue;
    let raw = {};
    try {
      raw = JSON.parse(r[4] || "{}") || {};
    } catch {
      report.notes.push(`${name}: unreadable VotesJSON, skipped`);
      continue;
    }
    const votes = {};
    for (const [bvKey, v] of Object.entries(raw)) {
      const val = mapVote(v);
      if (val === null) continue;
      const k = to(bvKey);
      if (!k) continue;
      if (votes[k] && votes[k] !== val) {
        report.clashes.push(`${name} voted ${votes[k]} and ${val} on two copies of ${k}; kept ${votes[k]}`);
        continue;
      }
      votes[k] = val;
    }
    voteCounts[name] = Object.keys(votes).length;
    voteRows.push([name, String(r[1] || ""), String(r[2] || ""), Object.keys(votes).length, JSON.stringify(votes)]);
  }

  // --- learning: Band Vote had one column per member; here it is one row each
  const learn = {};
  const pHead = (source.progressRows || [])[0] || [];
  const members = [];
  for (let c = 3; c < pHead.length; c++) {
    const n = String(pHead[c] || "").trim();
    if (n) members.push({ n, c });
  }
  for (const r of (source.progressRows || []).slice(1)) {
    const k = to(r[0]);
    if (!k) continue;
    for (const { n, c } of members) {
      const v = mapProgress(r[c]);
      if (!v) continue;
      const blob = (learn[n] ||= {});
      if (blob[k] && blob[k] !== v) {
        report.clashes.push(`${n} marked ${k} both ${blob[k]} and ${v}; kept ${blob[k]}`);
        continue;
      }
      blob[k] = v;
    }
  }
  const learnRows = Object.entries(learn).map(([n, blob]) => [
    n, String(Date.now()), "bandvote-v32", Object.values(blob).filter((v) => v === "KNOW").length,
    JSON.stringify(blob),
  ]);

  // --- settings
  const limitRow = (source.settingsRows || []).find(
    (r) => String(r[0] || "").trim().toLowerCase() === "song limit"
  );
  const songLimit = Math.round(Number(limitRow && limitRow[1])) || 17;
  const voters = [...NOV_BAND];
  for (const r of voteRows) {
    if (!voters.some((v) => v.toLowerCase() === r[0].toLowerCase())) voters.push(r[0]);
  }
  const settings = {
    showName: "Bun's & Roses",
    bandName: "Bun's & Roses",
    occasion: source.occasion || "",
    gigDate: source.gigDate || "",
    owner: "Rich",
    voters,
    band: [...NOV_BAND],
    maxSongs: songLimit,
    maxPerArtist: 1,
    budgetSeconds: 0,
    gapSeconds: 0,
    tieBreak: "shorter",
    orderEngine: "curve",
    eras: ["70s/80s", "90s+"],
    leads: [],
    warnings: ["waiting", "flatStretch", "dedication", "cuts"],
    locked: false,
    lockedKeys: [],
  };
  const settingsRows = Object.entries(settings).map(([k, v]) => [
    k, typeof v === "object" ? JSON.stringify(v) : String(v),
  ]);

  // --- library tabs: add what is missing, never overwrite what is there
  const ex = source.existing || {};
  const libraryAdds = songs.filter((s) => !(ex.library || new Set()).has(s.k)).map(libraryRow);

  const lyricsAdds = [];
  for (const r of source.lyricsRows || []) {
    const k = String(r[0] || "").trim() || (r[1] ? songKey(r[1], r[2]) : "");
    if (!k) continue;
    const text = String(r[3] || "");
    const have = (ex.lyrics || {})[k];
    if (have !== undefined) {
      if (have.trim() && text.trim() && have.trim() !== text.trim()) {
        report.clashes.push(`Lyrics ${k}: kept this app's words`);
      }
      continue;
    }
    lyricsAdds.push([k, String(r[1] || ""), String(r[2] || ""), text]);
  }

  const tempoAdds = [];
  for (const r of source.tempoRows || []) {
    const k = String(r[0] || "").trim() || (r[1] ? songKey(r[1], r[2]) : "");
    if (!k || (ex.tempos || {})[k]) continue;
    tempoAdds.push([k, String(r[1] || ""), String(r[2] || ""), String(r[3] || ""), String(r[4] || "")]);
  }

  const tuningAdds = [];
  for (const r of source.tuningRows || []) {
    const k = String(r[0] || "").trim() || (r[1] ? songKey(r[1], r[2]) : "");
    if (!k) continue;
    const val = String(r[3] || "").trim();
    const have = (ex.tunings || {})[k];
    if (have !== undefined) {
      if ((have || "") !== val) report.clashes.push(`Tuning ${k}: kept "${have}" (Band Vote had "${val}")`);
      continue;
    }
    tuningAdds.push([k, String(r[1] || ""), String(r[2] || ""), val]);
  }

  return {
    songs,
    tabs: {
      Songs: songs.map(songRow),
      Votes: voteRows,
      Learning: learnRows,
      Settings: settingsRows,
    },
    library: { Library: libraryAdds, Lyrics: lyricsAdds, Tempos: tempoAdds, Tunings: tuningAdds },
    settings,
    voteCounts,
    learnCounts: Object.fromEntries(Object.entries(learn).map(([n, b]) => [n, Object.keys(b).length])),
    report: { ...report, unmapped: [...new Set(report.unmapped)] },
  };
}
