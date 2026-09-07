// Shared domain constants and helpers. Imported by the serverless functions
// and safe to import from the browser — no Node built-ins, no secrets.

// Scoring. Single source of truth: the API and both pages read these, so
// changing a number here changes everything. Kept identical to the Apps
// Script version this replaced, so historic votes keep their exact weight.
export const WEIGHTS = { MUST: 6, YES: 2, MAYBE: 1, NO: -4 };

// "X" is a marker on the pick-ONE locked sections, not a scored vote.
export const VOTE_VALUES = ["MUST", "YES", "MAYBE", "NO", "X"];

// Who votes. Server-side source of truth; config.js repeats it for the browser
// so a page still renders with the API down.
//
// A name removed here stops counting immediately — their row on the Votes tab
// is left alone, so nothing is destroyed and putting the name back restores
// their ballot. CJ left the band and Ethan replaced him: CJ's votes no longer
// shape the set, and Ethan starts with a blank ballot rather than inheriting
// opinions he never gave.
export const VOTERS = ["Rich", "Ashley", "Ethan", "Justin", "Isaac", "Julie", "Organiser"];

// Who actually plays. Julie and the organiser vote on the setlist but are not
// in the band, so they never appear on the practice tracker — being asked
// whether you know a song you will not be playing is just noise.
export const BAND = ["Rich", "Ashley", "Ethan", "Justin", "Isaac"];

// How well each player knows each song. Deliberately a separate axis from the
// vote: a song you love and have never played is MUST + NOT STARTED. Absent
// from someone's blob means "hasn't said", which is NOT "not started" — the
// first tells you nothing, the second is a commitment to learn it.
export const LEARN_VALUES = ["NOT STARTED", "IN PROGRESS", "KNOW"];

export function isLearnValue(v) {
  return LEARN_VALUES.includes(String(v || "").trim().toUpperCase());
}

// No more than this many songs by any one band make the final set. Counted
// across locked songs too. 0 disables the cap.
export const MAX_PER_ARTIST = 2;

export function voteWeight(v) {
  const k = String(v || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(WEIGHTS, k) ? WEIGHTS[k] : 0;
}

/** Is this a value we accept into the Votes blob at all? */
export function isVoteValue(v) {
  return VOTE_VALUES.includes(String(v || "").trim().toUpperCase());
}

/** Stable per-song identity. Survives renames of section/lead/length. */
export function songKey(name, artist) {
  const slug = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "x";
  return slug(name) + "-" + slug(artist);
}

/** "3:56" -> 236. 0 means unreadable. */
export function lenSecs(raw) {
  const t = String(raw == null ? "" : raw)
    .trim()
    .toUpperCase()
    .replace(/\s*[AP]\.?M\.?$/, "")
    .trim();
  const m = t.match(/^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (!m) return 0;
  let secs;
  if (m[3] === undefined) secs = +m[1] * 60 + +m[2];
  else {
    secs = +m[1] * 3600 + +m[2] * 60 + +m[3];
    if (secs > 900) secs = +m[1] * 60 + +m[2]; // "3:23:00" means 3m23s
  }
  return secs > 0 && secs <= 900 ? secs : 0;
}

export function mmss(secs) {
  return Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
}

/**
 * Guitar tunings for the October running order. These only ever SEED empty
 * rows in the Tunings tab — once a row exists the sheet is authoritative,
 * including a deliberately blank cell. Blank is read as E standard.
 */
export const TUNING_SEEDS = [
  { name: "Jump", artist: "Van Halen", tuning: "Eb standard" },
  { name: "Misery Business", artist: "Paramore", tuning: "E standard" },
  { name: "Teenage Dirtbag", artist: "Wheatus", tuning: "E standard" },
  { name: "Zombie", artist: "The Cranberries", tuning: "E standard" },
  { name: "Bring Me to Life", artist: "Evanescence", tuning: "Drop D" },
  { name: "How You Remind Me", artist: "Nickelback", tuning: "Drop D" },
  { name: "What I've Done", artist: "Linkin Park", tuning: "Drop D" },
  { name: "What If", artist: "Creed", tuning: "Drop D" },
  { name: "Cryin'", artist: "Aerosmith", tuning: "E standard" },
  { name: "Still Into You", artist: "Paramore", tuning: "E standard" },
  { name: "The Diary of Jane", artist: "Breaking Benjamin", tuning: "Drop D" },
  { name: "Going Under", artist: "Evanescence", tuning: "Drop D" },
  { name: "Dance, Dance", artist: "Fall Out Boy", tuning: "Drop D" },
  { name: "The Sound of Silence", artist: "Disturbed", tuning: "E standard" },
  { name: "Hit Me With Your Best Shot", artist: "Pat Benatar", tuning: "E standard" },
  { name: "Creep", artist: "Radiohead", tuning: "E standard" },
  { name: "You Give Love a Bad Name", artist: "Bon Jovi", tuning: "E standard" },
  { name: "Faithfully", artist: "Journey", tuning: "E standard" },
  { name: "Smells Like Teen Spirit", artist: "Nirvana", tuning: "E standard" },
  { name: "Don't Stop Believin'", artist: "Journey", tuning: "E standard" },
];
