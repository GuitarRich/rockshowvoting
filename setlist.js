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

// Availability, one answer per person per day. Absent means "hasn't said",
// which is NOT "can't make it" — the calendar shows those differently, because
// an unanswered day is a chase and a NO is a fact.
export const AVAILABILITY_VALUES = ["YES", "NO"];

export function availabilityValue(raw) {
  const v = String(raw || "").trim().toUpperCase();
  return AVAILABILITY_VALUES.includes(v) ? v : "";
}

/** Days are plain "YYYY-MM-DD" strings — no dates, no timezones, no drift. */
export function isDayKey(k) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(k || "").trim());
}

// How much the keyboard matters on a song. Blank means nobody has said yet,
// which is NOT the same as NONE — a keys player needs to know the difference
// between "no part needed" and "no answer".
export const KEYBOARD_VALUES = ["ESSENTIAL", "ADDS", "NONE"];

export function keyboardValue(raw) {
  const v = String(raw || "").trim().toUpperCase();
  return KEYBOARD_VALUES.includes(v) ? v : "";
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


// ===========================================================================
// Running order.
//
// Two engines, kept exactly as each show was built and tested with them:
//
//   "pacing"  October's: best-fit against an energy curve, then pairwise
//             swaps. Knows the heavy / lift / dip tags. Lifted verbatim from
//             the October results page, so its running order does not move.
//   "curve"   Band Vote's: seed against a target curve, then adjacent-swap
//             repair on one cost table. What November was voted and learnt on.
//
// Selection is finished before either runs: ordering never adds or drops a
// song, it only decides which slot each one lands in.
// ===========================================================================

/**
 * Built-in energy and tags for October's songs, used only for rows the sheet
 * has not curated (no Energy value). Goes away once every song's facts live in
 * the Library tab.
 */
export const META = {
  "Dance, Dance":{e:4},
  "Creep":{e:2,tags:["dip"]},
  "Higher":{e:3},"My Sacrifice":{e:3},"One Last Breath":{e:2,tags:["ballad"]},
  "With Arms Wide Open":{e:2,tags:["ballad"]},
  "How You Remind Me":{e:3},"Rockstar":{e:3},"Burn It to the Ground":{e:4},"Photograph|Nickelback":{e:3},
  "Any Way You Want It":{e:4,tags:["opener"]},
  "Don't Stop Believin'":{e:4,tags:["closer"]},
  "You Give Love a Bad Name":{e:4,tags:["opener"]},
  "Livin' on a Prayer":{e:5,tags:["closer"]},
  "It's My Life":{e:4},
  "Pour Some Sugar on Me":{e:4,tags:["closer"]},
  "Photograph|Def Leppard":{e:4},
  "Walk This Way":{e:4},
  "I Don't Want to Miss a Thing":{e:1,tags:["ballad","dedication"]},
  "Jump":{e:4,tags:["opener"]},
  "Sweet Child o' Mine":{e:3},
  "Eye of the Tiger":{e:4,tags:["opener"]},
  "Kryptonite":{e:3},"When I'm Gone":{e:3},
  "Animal I Have Become":{e:4,tags:["heavy"]},
  "I Hate Everything About You":{e:4,tags:["heavy"]},
  "The Diary of Jane":{e:4,tags:["heavy"]},
  "Blow Me Away":{e:4,tags:["heavy"]},
  "Down with the Sickness":{e:5,tags:["heavy"]},
  "The Sound of Silence":{e:2,tags:["dip"]},
  "In the End":{e:4},"Numb":{e:3},"Faint":{e:5,tags:["heavy"]},"What I've Done":{e:3},
  "Smells Like Teen Spirit":{e:4},"Come as You Are":{e:3},"Zombie":{e:3},
  "Barracuda":{e:4},"Alone":{e:2,tags:["ballad"]},
  "Hit Me With Your Best Shot":{e:4,tags:["opener"]},
  "I Love Rock 'n' Roll":{e:4,tags:["opener"]},
  "Bring Me to Life":{e:4},"Going Under":{e:4},
  "Misery Business":{e:4},"Still Into You":{e:4,tags:["lift"]},
  "What's Up?":{e:3},"You Oughta Know":{e:4},
  "Love Bites (So Do I)":{e:4,tags:["heavy"]},
  "One Way or Another":{e:4,tags:["opener"]},
  "Total Eclipse of the Heart":{e:2,tags:["ballad"]},
  // added after the first draft — energy/tags here are fallbacks only, the
  // sheet's Energy and Tags columns win where they're filled in
  "Cryin'":{e:2,tags:["ballad"]},
  "Faithfully":{e:1,tags:["ballad","dedication"]},
  "Dream On":{e:3},
  "Sweet Emotion":{e:4},
  "Teenage Dirtbag":{e:3},
  "What If":{e:4,tags:["heavy"]},
  "Mr. Brightside":{e:4,tags:["lift"]},
  "Learn to Fly":{e:4},
  "Two Princes":{e:3,tags:["dip"]}
};

/**
 * A row's energy and tags. A row with an Energy value has been curated in the
 * sheet, so its Tags are used EXACTLY — blank included. Only an uncurated row
 * falls back to META, and "-" or "none" in its Tags forces empty even then.
 */
export function songMeta(r) {
  const key = META[r.song + "|" + r.artist] ? r.song + "|" + r.artist : r.song;
  const fb = META[key] || { e: 3 };
  const curated = Number(r.energy) > 0;
  const tags = Array.isArray(r.tags) ? r.tags : String(r.tags || "").split(/[,;]\s*/);
  const sheetTags = tags.filter((t) => t && !/^(-|none)$/i.test(t));
  const cleared = curated || tags.some((t) => /^(-|none)$/i.test(t));
  return {
    e: curated ? Number(r.energy) : fb.e,
    tags: sheetTags.length ? sheetTags : cleared ? [] : fb.tags || [],
  };
}

/**
 * October's engine. `list` items carry e, tags, score, artist and lead; the
 * input order matters only for ties, and callers pass rows in sheet order.
 */
export function orderPacing(list) {

  const n = list.length;
  if(!n) return [];
  const curve = f => f<0.10 ? 4.5 : f<0.32 ? 3.1 : f<0.52 ? 3.9 : f<0.80 ? 4.8 : 4.4;

  // A song counts as SLOW if it's low energy or carries a slow-ish tag. Energy
  // alone isn't enough: a power ballad often gets entered as energy 3.
  const SLOW = s => s.e <= 2 || s.tags.includes('ballad')
                 || s.tags.includes('dedication') || s.tags.includes('dip');

  // How many slots at each end are treated as protected. All the penalty
  // weights below are deliberately on the same scale as the adjacency ones in
  // adj() — an earlier version used 3s here against 18s there, so the pacing
  // rules simply bulldozed the opening and the finish.
  const TAIL = n >= 8 ? 3 : 1;

  // --- fit cost of putting song s at slot i (position only, no neighbours)
  function fit(s,i){
    const f = n>1 ? i/(n-1) : 0;
    let c = Math.abs(s.e - curve(f));
    // A ballad belongs after the peak. `dip` songs can sit early — that's what
    // the tag means — but a ballad in the first third is a dancefloor killer,
    // so this has to be weighted like the adjacency rules, not below them.
    if(s.tags.includes('dedication')){
      c += Math.abs(f-0.74)*22;
      if(f < 0.40) c += 18;
    } else if(s.tags.includes('ballad')){
      c += (f>0.50 && f<0.88) ? 0 : 11;
      if(f < 0.35) c += 16;
    }
    if(s.tags.includes('heavy')) c += (f>0.48 && f<0.84) ? 0 : 1.6;
    if(s.tags.includes('dip'))   c += (f>0.16 && f<0.46) ? 0 : 3.2;
    if(s.tags.includes('lift'))  c += (f>0.74) ? 0 : 1.0;
    if(s.tags.includes('opener')) c += (i===0) ? -6 : (i >= n-TAIL ? 6 : 0.3);
    if(s.tags.includes('closer')) c += (i===n-1) ? -14 : (i >= n-TAIL ? -3 : 4);

    // THE FINISH: the last few songs have to be hot. This has to outweigh the
    // slow-clustering penalties or the optimiser will happily wreck the ending
    // to fix a trough in the middle.
    if(i >= n - TAIL){
      if(SLOW(s))      c += 30;               // never finish on a slow song
      else if(s.e >= 4) c -= 3;
      else              c += (4 - s.e) * 9;
    }
    // THE OPENING: the first slot must be hot, and nothing slow belongs in the
    // first three — you establish the energy before you're allowed to spend it.
    if(i === 0){
      if(SLOW(s))      c += 30;
      else if(s.e >= 4) c -= 3;
      else              c += (4 - s.e) * 9;
    }
    if(i < TAIL && SLOW(s)) c += 20;
    return c - s.score*0.015;
  }

  // --- pass 1: repeatedly take the globally cheapest (song, slot) pair
  const free = new Set(list.map((_,i)=>i));
  const slots = new Array(n).fill(null);
  const openSlots = new Set(list.map((_,i)=>i));
  while(free.size){
    let bs=-1, bi=-1, bc=Infinity;
    for(const si of free) for(const i of openSlots){
      const c = fit(list[si], i);
      if(c < bc){ bc=c; bs=si; bi=i; }
    }
    slots[bi] = list[bs];
    free.delete(bs); openSlots.delete(bi);
  }

  // --- pass 2: repair adjacency
  const adj = arr => {
    let p = 0;
    for(let i=0;i<arr.length;i++){
      const a=arr[i], b=arr[i-1], c=arr[i-2];
      if(b && b.artist===a.artist) p += 10;
      if(b && c && b.lead===a.lead && c.lead===a.lead) p += 15;   // three in a row: no
      if(b && b.lead===a.lead) p += 3;                             // two: discouraged
      // never two slow songs back to back, and preferably not one apart either
      if(b && SLOW(a) && SLOW(b)) p += 18;
      if(c && SLOW(a) && SLOW(c)) p += 7;
    }
    // no long flat stretch: penalise any 4-song window whose average energy
    // sags. This is what catches a trough built from mid-tempo songs that are
    // individually fine — the killer is four in a row, not any one of them.
    for(let i=3;i<arr.length;i++){
      let t = 0;
      for(let k=i-3;k<=i;k++) t += arr[k].e;
      const avg = t/4;
      if(avg < 3.1) p += (3.1-avg)*14;
    }
    return p;
  };
  const cost = arr => arr.reduce((t,s,i)=>t+fit(s,i),0) + adj(arr);
  let cur = slots.slice(), best = cost(cur);
  for(let pass=0; pass<6; pass++){
    let improved = false;
    for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){
      const t = cur.slice();
      [t[i],t[j]] = [t[j],t[i]];
      const c = cost(t);
      if(c < best - 1e-9){ cur = t; best = c; improved = true; }
    }
    if(!improved) break;
  }
  return cur;
}


/* ----- Band Vote's engine ("curve") ----- */

export function tagsOf(s) {
  const raw = s && s.tags;
  const list = Array.isArray(raw)
    ? raw
    : String(raw || "")
        .split(/[,;]/)
        .map((t) => t.trim().toLowerCase());
  return list.filter((t) => t && t !== "-" && t !== "none");
}

export function energyOf(s) {
  const e = Number(s && s.energy);
  return e > 0 ? e : 0;
}

export function isSlow(s) {
  if (tagsOf(s).includes("slow")) return true;
  const e = energyOf(s);
  return e > 0 && e <= 2;
}

export function targetEnergy(i, n) {
  if (n <= 1) return 4.5;
  const t = i / (n - 1);
  return 4.5 - 8 * t * (1 - t) + 0.5 * t;
}

export function seedOrder(songs) {
  const n = songs.length;
  if (n <= 1) return songs.slice();
  const remaining = songs.slice();
  const order = new Array(n).fill(null);

  const closerAt = remaining.findIndex((s) => tagsOf(s).includes("closer"));
  if (closerAt >= 0) order[n - 1] = remaining.splice(closerAt, 1)[0];

  const openerAt = remaining.findIndex((s) => tagsOf(s).includes("opener"));
  if (openerAt >= 0 && !order[0]) order[0] = remaining.splice(openerAt, 1)[0];

  for (let i = 0; i < n; i++) {
    if (order[i]) continue;
    const target = targetEnergy(i, n);
    let best = 0;
    let bestD = Infinity;
    remaining.forEach((s, j) => {
      const e = energyOf(s);
      const d = Math.abs((e || target) - target);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    order[i] = remaining.splice(best, 1)[0];
  }
  return order;
}

export function orderCost(songs) {
  const n = songs.length;
  if (!n) return 0;
  let cost = 0;
  const slow = songs.map(isSlow);
  const total = songs.reduce((a, s) => a + (s.dur || 0), 0) || 1;

  for (let i = Math.max(0, n - 3); i < n; i++) if (slow[i]) cost += 30;
  for (let i = 0; i < Math.min(3, n); i++) if (slow[i]) cost += 20;
  for (let i = 0; i < n - 1; i++) if (slow[i] && slow[i + 1]) cost += 18;

  let t = 0;
  songs.forEach((s) => {
    if (tagsOf(s).includes("dedication") && t / total < 0.4) cost += 18;
    t += s.dur || 0;
  });

  const third = Math.ceil(n / 3);
  for (let i = 0; i < third; i++) if (tagsOf(songs[i]).includes("ballad")) cost += 16;

  for (let i = 0; i < n - 2; i++) {
    const a = String(songs[i].lead || "").trim();
    if (!a) continue;
    const b = String(songs[i + 1].lead || "").trim();
    const c = String(songs[i + 2].lead || "").trim();
    if (a && a === b && a === c) cost += 15;
  }

  const hasCloser = songs.some((s) => tagsOf(s).includes("closer"));
  if (hasCloser && !tagsOf(songs[n - 1]).includes("closer")) cost += 14;

  for (let i = Math.max(0, n - 3); i < n; i++) {
    const e = energyOf(songs[i]);
    if (e > 0 && e < 4) cost += (4 - e) * 9;
  }

  for (let i = 0; i <= n - 4; i++) {
    const es = songs.slice(i, i + 4).map(energyOf);
    if (es.some((e) => e <= 0)) continue;
    const avg = es.reduce((a, b) => a + b, 0) / 4;
    if (avg < 3.1) cost += (3.1 - avg) * 14;
  }

  return cost;
}

export function repairOrder(songs) {
  let order = songs.slice();
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 400) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      const cur = orderCost(order);
      const swapped = order.slice();
      const tmp = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = tmp;
      if (orderCost(swapped) < cur - 1e-9) {
        order = swapped;
        improved = true;
      }
    }
  }
  return order;
}

export function orderSet(keep) {
  return repairOrder(seedOrder(keep));
}

/** Reorder by identity keys. Dropped songs are skipped; new songs append in auto order. */
export function applySavedOrder(autoOrder, savedKeys) {
  if (!savedKeys || !savedKeys.length) return autoOrder.slice();
  const byK = {};
  autoOrder.forEach((s) => {
    byK[s.k] = s;
  });
  const used = new Set();
  const out = [];
  savedKeys.forEach((k) => {
    if (byK[k] && !used.has(k)) {
      out.push(byK[k]);
      used.add(k);
    }
  });
  autoOrder.forEach((s) => {
    if (!used.has(s.k)) out.push(s);
  });
  return out;
}


export function moveKey(keys, from, to) {
  const next = keys.slice();
  const item = next.splice(from, 1)[0];
  next.splice(to, 0, item);
  return next;
}

/** One row's score, MUST count and pick-ONE marks over a roster. */
export function scoreRow(votes, roster, weights = WEIGHTS) {
  let score = 0;
  let musts = 0;
  let xs = 0;
  for (const name of roster) {
    const v = String((votes && votes[name]) || "").toUpperCase();
    if (v === "X") {
      xs++;
      continue;
    }
    if (weights[v] !== undefined) score += weights[v];
    if (v === "MUST") musts++;
  }
  return { score, musts, xs };
}

/**
 * The automatic running order of the songs in a set, as keys.
 *
 * `rows` are payload rows (k, song, artist, lead, len, energy, tags, votes),
 * already filtered to the set and in sheet order. `engine` is "pacing"
 * (October) or "curve" (Band Vote).
 */
export function autoOrder(rows, { engine = "pacing", roster = [], weights = WEIGHTS } = {}) {
  if (engine === "curve") {
    const items = rows.map((r) => {
      const sc = scoreRow(r.votes, roster, weights);
      return {
        k: r.k, artist: r.artist, lead: r.lead, energy: Number(r.energy) || 0,
        tags: r.tags || [], dur: lenSecs(r.len), sum: sc.score, musts: sc.musts,
      };
    });
    // Band Vote ordered its set from the ranked list, so ties in the seed
    // pass break the same way here.
    items.sort((a, b) => b.sum - a.sum || b.musts - a.musts || a.dur - b.dur);
    return orderSet(items).map((s) => s.k);
  }
  const items = rows.map((r) => {
    const m = songMeta(r);
    return {
      k: r.k, song: r.song, artist: r.artist, lead: String(r.lead || "").toUpperCase(),
      e: m.e, tags: m.tags, score: scoreRow(r.votes, roster, weights).score,
    };
  });
  return orderPacing(items).map((s) => s.k);
}

/**
 * The running order everyone sees: a saved Order when the sheet has one
 * (songs without a position close up at the end, in automatic order), and
 * the automatic order otherwise.
 */
export function runningOrder(rows, opts = {}) {
  const auto = autoOrder(rows, opts);
  const saved = rows
    .filter((r) => Number(r.order) > 0)
    .sort((a, b) => a.order - b.order)
    .map((r) => r.k);
  if (!saved.length) return { order: auto, mode: "auto" };
  const byK = new Map(auto.map((k) => [k, { k }]));
  return {
    order: applySavedOrder(auto.map((k) => byK.get(k)), saved).map((s) => s.k),
    mode: "saved",
  };
}

/**
 * Escape text for interpolation into innerHTML. Song titles, artists, tunings
 * and member names all reach the pages from the sheet — anyone who can add a
 * song or edit a tab can otherwise put markup on everyone else's screen.
 */
export function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/** Search links built from the song itself: nothing to maintain, nothing copied. */
export function searchLinks(song) {
  const q = encodeURIComponent((song.artist || "") + " " + (song.name || song.song || ""));
  return {
    ug:
      "https://www.ultimate-guitar.com/search.php?search_type=title&order=myweight&value=" + q,
    songsterr: "https://www.songsterr.com/?pattern=" + q,
    musescore: "https://www.musescore.com/sheetmusic?text=" + q,
    genius: "https://genius.com/search?q=" + q,
  };
}

/** Band readiness over a set: per player, and the songs everyone knows. */
export function readiness(rows, band) {
  const per = {};
  for (const n of band) per[n] = { know: 0, progress: 0, notStarted: 0, unanswered: 0 };
  let allKnow = 0;
  for (const r of rows) {
    let everyone = band.length > 0;
    for (const n of band) {
      const v = String((r.learn && r.learn[n]) || "").toUpperCase();
      if (v === "KNOW") per[n].know++;
      else if (v === "IN PROGRESS") per[n].progress++;
      else if (v === "NOT STARTED") per[n].notStarted++;
      else per[n].unanswered++;
      if (v !== "KNOW") everyone = false;
    }
    if (everyone) allKnow++;
  }
  return { per, allKnow, total: rows.length };
}

/* ---------- tempo: the click track ---------- */

/** Column layout of the Tempos sheet tab. */
export const TEMPO_HEADERS = ["Key", "Title", "Artist", "BPM", "Beats per bar"];

export const MIN_BPM = 30;
export const MAX_BPM = 300;
export const DEFAULT_BEATS = 4;

/** A playable tempo, or 0 for anything that isn't one. */
export function normBpm(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, n));
}

/** Beats in a bar: 3 for a waltz, 6 for Ramble On's feel, 4 for the rest. */
export function normBeats(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_BEATS;
  return Math.min(12, n);
}

/** Tempos sheet rows -> { key: { bpm, beats } }. */
export function parseTempos(rows) {
  const out = {};
  (rows || []).forEach((r) => {
    const key = String(r[0] || "").trim() || (r[1] ? songKey(r[1], r[2]) : "");
    if (!key) return;
    out[key] = { bpm: normBpm(r[3]), beats: normBeats(r[4]) };
  });
  return out;
}

/**
 * Resolve a song's click tempo. The sheet wins when it holds a usable number,
 * otherwise the catalog's own bpm carries it.
 *
 * This is deliberately the opposite of tuningFor's rule. A blank tuning cell is
 * a real answer — "no special tuning" — but a blank BPM is not: a click with no
 * tempo can't run, so a cleared cell falls back to the catalog rather than
 * leaving the drummer with nothing.
 */
export function tempoFor(map, song) {
  const s = song || {};
  const k = songKey(s.name, s.artist);
  const row = map && map[k];
  const fromSheet = normBpm(row && row.bpm);
  const fromSong = normBpm(s.bpm);
  return {
    bpm: fromSheet || fromSong,
    beats: normBeats(row ? row.beats : DEFAULT_BEATS),
    source: fromSheet ? "sheet" : fromSong ? "song" : "none",
  };
}

/**
 * Tempo from a run of taps: the gaps between them, averaged. Timestamps in ms.
 *
 * Gaps more than half again the median are dropped — a tap that lands late
 * because someone lost the thread shouldn't drag the whole average down — and
 * only the last 8 taps count, so the number chases a change of mind rather
 * than averaging it away.
 */
export function tapTempo(times) {
  const t = (times || []).map(Number).filter((n) => Number.isFinite(n)).slice(-8);
  if (t.length < 2) return 0;
  const gaps = [];
  for (let i = 1; i < t.length; i++) {
    const gap = t[i] - t[i - 1];
    if (gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return 0;
  const sorted = gaps.slice().sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const kept = gaps.filter((g) => g <= mid * 1.5 && g >= mid * 0.5);
  const use = kept.length ? kept : gaps;
  const avg = use.reduce((a, b) => a + b, 0) / use.length;
  return normBpm(60000 / avg);
}

/** Seconds per beat, and the bar length, for one tempo. */
export function beatPlan(bpm, beats) {
  const rate = normBpm(bpm);
  const per = normBeats(beats);
  return { bpm: rate, beats: per, spb: rate ? 60 / rate : 0, bar: rate ? (60 / rate) * per : 0 };
}

/** Which beat of which bar beat number n is. Beat 0 is bar 1, beat 1 — accented. */
export function barPosition(n, beats) {
  const per = normBeats(beats);
  const i = Math.max(0, Math.floor(Number(n) || 0));
  return { bar: Math.floor(i / per) + 1, beat: (i % per) + 1, accent: i % per === 0 };
}

/**
 * Every beat falling in the window (from, to], as absolute times on the same
 * clock the caller passed in.
 *
 * The click schedules ahead of itself rather than firing on a timer: a setTimeout
 * loop drifts, and a drifting click is worse than no click. The caller hands
 * this a slice of audio-clock time, gets back the beats due in it, and books
 * them. Kept out of the loop so the arithmetic is testable without a browser —
 * same reason advanceScroll is its own function.
 */
export function beatsDue(plan, from, to, startAt) {
  const spb = plan && plan.spb;
  if (!spb) return [];
  const zero = Number(startAt) || 0;
  const a = Math.max(zero, Number(from) || 0);
  const b = Number(to) || 0;
  if (b <= a) return [];
  const out = [];
  let n = Math.max(0, Math.ceil((a - zero) / spb));
  // A beat sitting exactly on the window's opening edge was booked by the last
  // pass — except at the very start, where beat 0 is the count-in downbeat and
  // this is the first pass to see it.
  if (a > zero && zero + n * spb <= a) n++;
  for (; zero + n * spb <= b; n++) {
    out.push({ n, at: zero + n * spb, ...barPosition(n, plan.beats) });
    if (out.length > 64) break;        // a stalled tab shouldn't book a minute of clicks
  }
  return out;
}

/**
 * How long the lamp stays lit. Short enough to read as a flash at 60bpm, and
 * still a visible gap at 200 — at fast tempos it's the dark that carries the
 * beat, not the light.
 */
export function flashMs(bpm) {
  const spb = beatPlan(bpm, DEFAULT_BEATS).spb;
  if (!spb) return 0;
  return Math.round(Math.min(110, Math.max(35, spb * 1000 * 0.32)));
}

/** Column layout of the Lyrics sheet tab. */
export const LYRICS_HEADERS = ["Key", "Title", "Artist", "Lyrics"];

/**
 * Lyrics sheet rows -> { key: text }. The band types the words into the sheet;
 * nothing ships with the app and nothing is fetched from a lyrics site, so the
 * sheet is the only source. A row with a blank cell still counts as a row —
 * same rule as tunings — so a cleared cell reads as "we have no words yet"
 * rather than falling through to something stale.
 */
export function parseLyrics(rows) {
  const out = {};
  (rows || []).forEach((r) => {
    const key = String(r[0] || "").trim() || (r[1] ? songKey(r[1], r[2]) : "");
    if (!key) return;
    out[key] = String(r[3] == null ? "" : r[3]);
  });
  return out;
}

/** Text for one song, normalised to \n line breaks. Missing song -> "". */
export function lyricsFor(map, name, artist) {
  const v = map && map[songKey(name, artist)];
  return String(v == null ? "" : v).replace(/\r\n?/g, "\n").trim();
}

/**
 * Split lyrics into blocks on blank lines, so a verse can be kept whole across
 * a page break instead of being cut mid-line.
 */
export function lyricBlocks(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((b) => b.replace(/\s+$/, ""))
    .filter((b) => b.trim().length);
}

/* ---------- chords ---------- */

/**
 * One chord symbol: root, accidental, quality, extensions, optional bass note.
 *
 * Deliberately built from named atoms rather than a loose character class,
 * because the book uses it to decide whether a whole LINE is chords rather
 * than words. A pattern like /^[A-G][a-z#b0-9]*$/ greys out real lyrics —
 * "Bad", "Cage", "Gas" all start with a note letter.
 */
const CHORD_QUAL = "(?:maj|Maj|min|Min|dim|Dim|aug|Aug|sus|add|alt|m|M|°|ø|\\+|-)";
const CHORD_EXT = "(?:[#b♯♭]?(?:13|11|2|4|5|6|7|9))";
const CHORD_RE = new RegExp(
  "^[A-G][#b♯♭]?" +
    "(?:" + CHORD_QUAL + "|" + CHORD_EXT + "|\\((?:" + CHORD_EXT + ")\\))*" +
    "(?:\\/[A-G][#b♯♭]?)?$"
);

/**
 * Things that share a chord line without being chords: bar lines, repeat marks
 * ("8x" and "x8" are both written), N.C., and beat slashes.
 */
const CHORD_FILLER_RE =
  /^(?:\|+|x ?\d+|\d+ ?x|\(x ?\d+\)|\(\d+ ?x\)|[-–—/%.,]+|N\.?C\.?|[()])$/i;

/**
 * Split one chord-line token off its bar lines. Tabs are written "|A5 |A5 | 8x"
 * with nothing between the bar and the chord, so a plain whitespace split hands
 * back "|A5", which is not a chord symbol and used to sink the whole line back
 * to being read as words.
 */
export function chordParts(tok) {
  const s = String(tok == null ? "" : tok);
  const lead = (/^[|:]+/.exec(s) || [""])[0];
  const trail = (/[|:]+$/.exec(s.slice(lead.length)) || [""])[0];
  const core = s.slice(lead.length, s.length - trail.length);
  return { lead, core, trail, chord: CHORD_RE.test(core) };
}

const SECTION_NAMES =
  "intro|verse|pre[- ]?chorus|chorus|refrain|bridge|middle ?8|instrumental|interlude|" +
  "solo|riff|breakdown|outro|ending|coda|tag|hook|link|vamp|repeat|acappella|a cappella";
const SECTION_FULL_RE = new RegExp("^(?:" + SECTION_NAMES + ")(?: ?\\d+| [A-Za-z])?$", "i");

/** Strip one layer of brackets and a trailing colon from a label. */
function bare(line) {
  return String(line || "")
    .trim()
    .replace(/^[[({]\s*/, "")
    .replace(/\s*[\])}]$/, "")
    .replace(/:$/, "")
    .trim();
}

/** True for "[Chorus]", "Verse 2", "(Solo)" — not for "Bridge over troubled water". */
export function isSectionLine(line) {
  const t = String(line || "").trim();
  if (!t) return false;
  const inner = bare(t);
  if (!inner || inner.length > 40) return false;
  // Anything bracketed that isn't a chord is a label: [Chorus] yes, [G] no.
  if (/^[[({]/.test(t) && /[\])}]$/.test(t)) return !CHORD_RE.test(inner);
  return SECTION_FULL_RE.test(inner);
}

/** Is one token a chord symbol? Exported so the book can make each one tappable. */
export function isChord(tok) {
  return CHORD_RE.test(String(tok || "").trim());
}

/**
 * True when a line is nothing but chord symbols. Every token has to be a chord
 * or a bar/repeat mark, and at least one has to be a real chord, so a lyric
 * that happens to open with "Am" doesn't turn the whole line amber.
 */
export function isChordLine(line) {
  const t = String(line || "").trim();
  if (!t) return false;
  let chords = 0;
  for (const raw of t.split(/\s+/)) {
    const { core, chord } = chordParts(raw);
    if (chord) { chords++; continue; }
    if (!core) continue;                       // a bar line on its own
    if (CHORD_FILLER_RE.test(core)) continue;
    return false;
  }
  return chords > 0;
}

/**
 * Expand inline ChordPro ("[G]Someone left the [D]cake out") into the
 * chord-line-above-words-line pair that Ultimate Guitar and paper songbooks
 * use, so both ways of writing a song render the same way.
 *
 * Returns null when the line has no inline chords, so plain text and bracketed
 * section labels fall straight through untouched.
 */
export function expandChordPro(line) {
  const src = String(line || "");
  if (!/\[[^\]]*\]/.test(src)) return null;

  let chords = "";
  let words = "";
  let found = 0;
  let last = 0;
  const re = /\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(src))) {
    words += src.slice(last, m.index);
    last = m.index + m[0].length;
    const sym = m[1].trim();
    if (!sym) continue;
    if (!CHORD_RE.test(sym)) { words += m[0]; continue; }  // [Chorus] is not a chord
    found++;
    // Two chords must never touch, and a chord sits over the syllable that
    // followed it in the source.
    if (chords.length && chords.length >= words.length) chords += " ";
    while (chords.length < words.length) chords += " ";
    chords += sym;
  }
  words += src.slice(last);
  if (!found) return null;
  return { chords: chords.replace(/\s+$/, ""), words: words.replace(/\s+$/, "") };
}

/**
 * One lyric block -> typed lines, so the book can style chords apart from
 * words and keep a chord row sitting over its syllable.
 */
export function lyricLines(text) {
  const out = [];
  String(text == null ? "" : text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((raw) => {
      const line = raw.replace(/\s+$/, "");
      if (!line.trim()) { out.push({ type: "gap", text: "" }); return; }
      if (isSectionLine(line)) { out.push({ type: "section", text: bare(line) }); return; }
      const pro = expandChordPro(line);
      if (pro) {
        if (pro.chords.trim()) out.push({ type: "chord", text: pro.chords });
        if (pro.words.trim()) out.push({ type: "words", text: pro.words });
        return;
      }
      out.push({ type: isChordLine(line) ? "chord" : "words", text: line });
    });
  return out;
}

/**
 * How far to scroll one song, and how fast, so its words go past the reader in
 * the time the song actually lasts.
 *
 * The distance is the song's height less one screenful: the run ends with the
 * last line at the bottom of the screen, not scrolled off the top of it. A song
 * shorter than the screen has nowhere to go and reports a speed of zero rather
 * than a division by nothing.
 */
export function scrollPlan(top, height, viewport, seconds) {
  const from = Math.max(0, Number(top) || 0);
  const to = Math.max(from, from + (Number(height) || 0) - (Number(viewport) || 0));
  const secs = Number(seconds) > 0 ? Number(seconds) : 0;
  const distance = to - from;
  return { from, to, distance, pxPerSec: distance > 0 && secs > 0 ? distance / secs : 0 };
}

/** Keep the speed override inside what a person can actually read. */
export function clampSpeed(mult) {
  const n = Number(mult);
  if (!Number.isFinite(n)) return 1;
  return Math.min(4, Math.max(0.25, Math.round(n * 100) / 100));
}

/**
 * One frame of an autoscroll run: where the page should be dt seconds later,
 * whether the song has finished, and what to show on the progress bar.
 *
 * Kept apart from the animation loop so the arithmetic can be tested without a
 * browser — a loop driven by requestAnimationFrame can only be watched, not
 * checked.
 */
export function advanceScroll(plan, pos, dt, mult) {
  const speed = plan.pxPerSec * clampSpeed(mult);
  const at = Math.min(plan.to, Math.max(plan.from, Number(pos) || 0));
  const next = Math.min(plan.to, at + speed * Math.max(0, Number(dt) || 0));
  const progress = plan.distance > 0 ? (next - plan.from) / plan.distance : 1;
  return {
    pos: next,
    done: next >= plan.to,
    progress: Math.max(0, Math.min(1, progress)),
    remaining: speed > 0 ? (plan.to - next) / speed : 0,
  };
}

/**
 * A chord row and the lyric row under it, cut into the pieces a phone can wrap.
 *
 * The monospace grid a chord sheet is written on only works while the line fits
 * the screen: on a phone the long ones run off the edge, and a chord you have
 * to swipe sideways to read is no use with a guitar in your hands. So the pair
 * is broken at every chord and every word start — the finest cut that still
 * keeps each chord sitting over its own syllable — and the page re-flows those
 * pieces like words instead of scrolling them.
 *
 * Returns [{ chord, text }] in reading order. A chord landing past the end of
 * the words — an outro riff, or a last chord after the final syllable — comes
 * back with empty text rather than being dropped.
 */
export function chordWords(chordLine, wordLine) {
  const text = String(wordLine == null ? "" : wordLine);
  const chords = [];
  let m;
  const cre = /\S+/g;
  while ((m = cre.exec(String(chordLine == null ? "" : chordLine))) !== null) {
    chords.push({ tok: m[0], col: m.index });
  }
  if (!chords.length) return text === "" ? [] : [{ chord: "", text }];

  const stops = new Set([0]);
  const wre = /\S+/g;
  while ((m = wre.exec(text)) !== null) stops.add(m.index);
  chords.forEach((c) => {
    if (c.col < text.length) stops.add(c.col);
  });
  const cols = [...stops].sort((a, b) => a - b);

  const out = [];
  cols.forEach((c, i) => {
    const stop = i + 1 < cols.length ? cols[i + 1] : text.length;
    const hit = chords.find((x) => x.col === c && x.col < text.length);
    const piece = text.slice(c, stop);
    if (hit || piece !== "") out.push({ chord: hit ? hit.tok : "", text: piece });
  });
  chords.filter((c) => c.col >= text.length).forEach((c) => out.push({ chord: c.tok, text: "" }));
  return out;
}

/** Does this block need the monospace grid? Only chord rows require alignment. */
export function hasChords(lines) {
  return (lines || []).some((l) => l && l.type === "chord");
}

