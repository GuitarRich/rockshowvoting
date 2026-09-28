/**
 * Engine tests ported from Band Vote (ordering, lyrics, chords, autoscroll,
 * tempo), plus the pieces added when the two apps merged: October's pacing
 * engine, the running order everyone shares, and band readiness.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  orderCost,
  seedOrder,
  orderSet,
  applySavedOrder,
  moveKey,
  mmss,
  songKey,
  chordWords,
  normBpm,
  normBeats,
  parseTempos,
  tempoFor,
  tapTempo,
  beatPlan,
  barPosition,
  beatsDue,
  flashMs,
  parseLyrics,
  lyricsFor,
  lyricBlocks,
  isChordLine,
  chordParts,
  isSectionLine,
  expandChordPro,
  lyricLines,
  hasChords,
  scrollPlan,
  clampSpeed,
  advanceScroll,
  esc,
  orderPacing,
  autoOrder,
  runningOrder,
  songMeta,
  readiness,
  scoreRow,
} from "../setlist.js";
import { chordShape, parseChord, stringsFor, fingering, TUNINGS } from "../chords.js";

function song(partial) {
  return {
    k: partial.k || partial.name,
    name: partial.name || partial.k,
    artist: partial.artist || "X",
    dur: partial.dur ?? 180,
    set: partial.set ?? 1,
    energy: partial.energy ?? 0,
    tags: partial.tags || "",
    lead: partial.lead || "",
    sum: partial.sum ?? 0,
    n: partial.n ?? 1,
    musts: partial.musts ?? 0,
  };
}


describe("ordering", () => {
  it("puts a closer last and an opener first", () => {
    const rows = [
      song({ k: "mid", energy: 3 }),
      song({ k: "end", tags: "closer", energy: 5 }),
      song({ k: "top", tags: "opener", energy: 5 }),
    ];
    const order = seedOrder(rows);
    assert.equal(order[0].k, "top");
    assert.equal(order[order.length - 1].k, "end");
  });

  it("charges for a slow song in the last three slots", () => {
    const fast = [song({ k: "a", energy: 5 }), song({ k: "b", energy: 5 }), song({ k: "c", energy: 5 })];
    const slowEnd = [song({ k: "a", energy: 5 }), song({ k: "b", energy: 5 }), song({ k: "c", energy: 1 })];
    assert.ok(orderCost(slowEnd) > orderCost(fast));
  });

  it("orderSet returns every song exactly once", () => {
    const rows = [1, 2, 3, 4, 5].map((i) => song({ k: "s" + i, energy: (i % 5) + 1 }));
    const out = orderSet(rows);
    assert.equal(out.length, rows.length);
    assert.deepEqual(new Set(out.map((r) => r.k)).size, rows.length);
  });
});

describe("applySavedOrder", () => {
  it("follows the saved keys, skips dropped songs, appends new ones", () => {
    const auto = [song({ k: "a" }), song({ k: "b" }), song({ k: "c" })];
    const out = applySavedOrder(auto, ["c", "gone", "a"]);
    assert.deepEqual(out.map((r) => r.k), ["c", "a", "b"]);
  });

  it("falls back to the automatic order when nothing is saved", () => {
    const auto = [song({ k: "a" }), song({ k: "b" })];
    assert.deepEqual(applySavedOrder(auto, []).map((r) => r.k), ["a", "b"]);
  });
});

describe("moveKey", () => {
  it("moves an item without losing any", () => {
    assert.deepEqual(moveKey(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
    assert.deepEqual(moveKey(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  });
});

describe("lyrics", () => {
  it("reads the sheet rows into a map, keyed like everything else", () => {
    const map = parseLyrics([
      ["", "Would?", "Alice In Chains", "line one\nline two"],
      ["custom1", "A Song", "A Band", "words"],
      ["", "", "", "orphan"],
    ]);
    assert.equal(map[songKey("Would?", "Alice In Chains")], "line one\nline two");
    assert.equal(map.custom1, "words");
    assert.equal(Object.keys(map).length, 2);
  });

  it("a row with a blank cell means no lyrics yet, not a missing song", () => {
    const map = parseLyrics([["", "Would?", "Alice In Chains", ""]]);
    assert.ok(songKey("Would?", "Alice In Chains") in map);
    assert.equal(lyricsFor(map, "Would?", "Alice In Chains"), "");
    assert.equal(lyricsFor({}, "Would?", "Alice In Chains"), "");
  });

  it("normalises windows line endings and trims the outer whitespace", () => {
    const map = parseLyrics([["k1", "T", "A", "\r\n one \r\n two \r\n"]]);
    assert.equal(map.k1.includes("\r"), true);
    assert.equal(lyricsFor({ k1: map.k1 }, "T", "A"), "");
    assert.equal(lyricsFor(parseLyrics([["", "T", "A", "\r\none\r\ntwo\r\n"]]), "T", "A"), "one\ntwo");
  });

  it("splits into blocks on blank lines so a verse survives a page break", () => {
    assert.deepEqual(lyricBlocks("one\ntwo\n\n\nthree"), ["one\ntwo", "three"]);
    assert.deepEqual(lyricBlocks(""), []);
    assert.deepEqual(lyricBlocks("   \n\n  "), []);
  });
});

describe("esc", () => {
  it("neutralises markup from song titles and member names", () => {
    assert.equal(esc('<img src=x onerror=alert(1)>'), "&lt;img src=x onerror=alert(1)&gt;");
    assert.equal(esc('<script>x</script>'), "&lt;script&gt;x&lt;/script&gt;");
    assert.equal(esc('" onmouseover="evil()'), "&quot; onmouseover=&quot;evil()");
    assert.equal(esc("it's & that"), "it&#39;s &amp; that");
  });

  it("leaves ordinary titles alone and survives blanks", () => {
    assert.equal(esc("Rock 'n' Roll"), "Rock &#39;n&#39; Roll");
    assert.equal(esc("Would?"), "Would?");
    assert.equal(esc(null), "");
    assert.equal(esc(undefined), "");
    assert.equal(esc(0), "0");
  });
});

describe("chords", () => {
  it("recognises chord symbols people actually write", () => {
    for (const c of ["G", "Am", "C#m7", "Dsus4", "F#m7b5", "Cmaj7", "G/B", "Bb",
                     "A7sus4", "Em9", "Ab/C", "Bm7/A", "Eb", "D°"]) {
      assert.equal(isChordLine(c), true, c);
    }
  });

  it("leaves lyrics alone even when they open with a note letter", () => {
    for (const w of ["Bad", "Cage", "Gas", "Adam", "Balm", "Cause", "Aim", "Dad",
                     "Gem", "Add", "Aug", "Bass", "Fade", "Dance",
                     "Someone left the cake out in the rain",
                     "Am I the only one who cares"]) {
      assert.equal(isChordLine(w), false, w);
    }
    assert.equal(isChordLine(""), false);
    assert.equal(isChordLine("   "), false);
  });

  it("reads a chord line with bars and repeat marks", () => {
    assert.equal(isChordLine("G      D       Em     C"), true);
    assert.equal(isChordLine("| Am | F | C | G  x2"), true);
    assert.equal(isChordLine("N.C."), false);   // no real chord on the line
    assert.equal(isChordLine("| | |"), false);
  });

  it("reads a riff written in bars, with the chord glued to the bar line", () => {
    assert.equal(isChordLine("|A5 |A5 | 8x"), true);
    assert.equal(isChordLine("|D Dsus4 D |D |D Dsus4 D |Dsus4 D |"), true);
    assert.equal(isChordLine("|E5 |E5 | 2x"), true);
    assert.equal(isChordLine("|A5 |A5 | x8"), true);
    // and it still knows words when it sees them
    assert.equal(isChordLine("See it on television, every day"), false);
  });

  it("splits a bar line off the chord so only the chord is tappable", () => {
    assert.deepEqual(chordParts("|A5"), { lead: "|", core: "A5", trail: "", chord: true });
    assert.deepEqual(chordParts("|A5|"), { lead: "|", core: "A5", trail: "|", chord: true });
    assert.deepEqual(chordParts("Dsus4"), { lead: "", core: "Dsus4", trail: "", chord: true });
    assert.equal(chordParts("|").chord, false);
    assert.equal(chordParts("|").core, "");
    assert.equal(chordParts("8x").chord, false);
    assert.equal(chordParts("").chord, false);
  });

  it("tells a section label from a chord in brackets", () => {
    for (const t of ["[Chorus]", "Verse 2", "(Solo)", "Pre-Chorus", "Intro", "Middle 8"]) {
      assert.equal(isSectionLine(t), true, t);
    }
    assert.equal(isSectionLine("[G]"), false);
    assert.equal(isSectionLine("[Am7]"), false);
    assert.equal(isSectionLine("Bridge over troubled water"), false);
    assert.equal(isSectionLine(""), false);
  });

  it("expands inline ChordPro into a chord row over the words", () => {
    const r = expandChordPro("[G]Someone left the [D]cake out");
    assert.equal(r.words, "Someone left the cake out");
    assert.equal(r.chords, "G                D");
    assert.equal(r.chords.indexOf("D"), r.words.indexOf("cake"));
  });

  it("never lets two inline chords touch", () => {
    const r = expandChordPro("[C][G]go");
    assert.equal(r.words, "go");
    assert.equal(r.chords, "C G");
  });

  it("passes plain text and bracketed labels through untouched", () => {
    assert.equal(expandChordPro("just some words"), null);
    assert.equal(expandChordPro("[Chorus] words"), null);
    assert.equal(expandChordPro(""), null);
  });

  it("types every line of a block so the book can style them apart", () => {
    assert.deepEqual(lyricLines("[Chorus]\nG       D\nHello there"), [
      { type: "section", text: "Chorus" },
      { type: "chord", text: "G       D" },
      { type: "words", text: "Hello there" },
    ]);
    assert.deepEqual(lyricLines("plain words"), [{ type: "words", text: "plain words" }]);
    assert.equal(lyricLines("")[0].type, "gap");
  });

  it("flags only the blocks that need the monospace grid", () => {
    assert.equal(hasChords(lyricLines("G  D\nwords")), true);
    assert.equal(hasChords(lyricLines("[Chorus]\njust words")), false);
    assert.equal(hasChords([]), false);
  });
});

describe("chord shapes", () => {
  const E = TUNINGS["e standard"];
  const grid = (sym, strings) => {
    const s = chordShape(sym, strings || E);
    return s ? s.frets.map((f) => (f < 0 ? "x" : f)).join("") : null;
  };

  it("finds the shape a guitarist would actually play", () => {
    const want = {
      C: "x32010", Am: "x02210", G: "320003", D: "xx0232", E: "022100",
      Em: "022000", Dm: "xx0231", A: "x02220", A7: "x02020", E7: "020100",
      D7: "xx0212", G7: "320001", Cmaj7: "x32000", Am7: "x02010", Em7: "020000",
      "G/B": "x20003", "C/G": "332010",
    };
    for (const [sym, frets] of Object.entries(want)) assert.equal(grid(sym), frets, sym);
  });

  it("reaches for a barre only when the shape needs one", () => {
    assert.equal(chordShape("D", E).barre, null);       // xx0232 is three fingers
    assert.equal(chordShape("A7", E).barre, null);      // x02020, index and ring
    assert.equal(grid("F"), "133211");
    assert.equal(chordShape("F", E).barre.fret, 1);
    assert.equal(grid("Bm"), "x24432");
    assert.equal(chordShape("Bm", E).barre.fret, 2);
  });

  it("puts the bass of a slash chord on the lowest string that sounds", () => {
    const g = chordShape("G/B", E);
    const low = g.frets.findIndex((f) => f >= 0);
    assert.equal((E[low] + g.frets[low]) % 12, 11);     // B
    const c = chordShape("C/G", E);
    const lowC = c.frets.findIndex((f) => f >= 0);
    assert.equal((E[lowC] + c.frets[lowC]) % 12, 7);    // G
  });

  it("works the shapes out again for a different tuning", () => {
    // Everything moves a fret when the whole guitar is a semitone down.
    assert.equal(grid("Eb", TUNINGS["eb standard"]), grid("E", E));
    assert.notEqual(grid("D", TUNINGS["drop d"]), grid("D", E));
    assert.equal(grid("D", TUNINGS["drop d"]), "000232");
  });

  it("reads the tuning tags the sheet actually contains", () => {
    assert.deepEqual(stringsFor("E standard"), TUNINGS["e standard"]);
    assert.deepEqual(stringsFor("E standard (riff is bass)"), TUNINGS["e standard"]);
    assert.deepEqual(stringsFor("Drop D"), TUNINGS["drop d"]);
    assert.deepEqual(stringsFor("Half step down"), TUNINGS["eb standard"]);
    assert.deepEqual(stringsFor(""), TUNINGS["e standard"]);
    assert.deepEqual(stringsFor("nonsense"), TUNINGS["e standard"]);
  });

  it("reads the notes out of a chord symbol", () => {
    assert.deepEqual([...parseChord("C").pcs].sort((a, b) => a - b), [0, 4, 7]);
    assert.deepEqual([...parseChord("Am").pcs].sort((a, b) => a - b), [0, 4, 9]);
    assert.deepEqual([...parseChord("G7").pcs].sort((a, b) => a - b), [2, 5, 7, 11]);
    assert.equal(parseChord("C5").third, null);        // power chord has no third
    assert.equal(parseChord("Csus4").third, 5);
    assert.equal(parseChord("G/B").slash, true);
    assert.equal(parseChord("G/B").bass, 11);
    assert.equal(parseChord("H"), null);
    assert.equal(parseChord("Cwobble"), null);
  });

  it("never asks for a fifth finger", () => {
    for (const sym of ["C", "F", "Bb", "Bm", "F#m", "Ab", "Eb", "B7", "C#m", "Bbm", "Dm7"]) {
      const s = chordShape(sym, E);
      assert.ok(s, sym);
      assert.ok(Math.max(...s.fingers) <= 4, sym + " needs " + Math.max(...s.fingers) + " fingers");
      const fretted = s.frets.filter((f) => f > 0);
      assert.ok(Math.max(...fretted) - Math.min(...fretted) <= 3, sym + " spans too far");
    }
  });

  it("keeps open strings out of shapes played up the neck", () => {
    for (const sym of ["C", "F", "Bb", "Eb", "Ab", "C#m", "F#", "B7", "D5"]) {
      const s = chordShape(sym, E);
      const fretted = s.frets.filter((f) => f > 0);
      if (fretted.length && Math.max(...fretted) > 5) {
        assert.ok(!s.frets.includes(0), sym + " mixes open strings with a high position");
      }
    }
  });

  it("gives the barre finger 1 and hands the rest out low fret first", () => {
    const f = fingering([1, 3, 3, 2, 1, 1]);
    assert.deepEqual(f.fingers, [1, 3, 4, 2, 1, 1]);
    assert.deepEqual(f.barre, { fret: 1, from: 0, to: 5 });
    assert.deepEqual(fingering([-1, 0, 2, 2, 1, 0]).fingers, [0, 0, 2, 3, 1, 0]);
    assert.equal(fingering([0, 0, 0, 0, 0, 0]).count, 0);
  });
});

describe("autoscroll pacing", () => {
  it("ends with the last line at the bottom of the screen, not off the top", () => {
    const p = scrollPlan(1000, 3000, 800, 300);
    assert.equal(p.from, 1000);
    assert.equal(p.to, 3200);          // 1000 + 3000 - 800
    assert.equal(p.distance, 2200);
  });

  it("paces itself to the length of the song", () => {
    const short = scrollPlan(0, 2000, 800, 120);
    const long = scrollPlan(0, 2000, 800, 300);
    assert.ok(short.pxPerSec > long.pxPerSec);
    assert.equal(long.pxPerSec * 300, long.distance);
  });

  it("has nowhere to go when the song already fits on screen", () => {
    const p = scrollPlan(1000, 500, 800, 300);
    assert.equal(p.distance, 0);
    assert.equal(p.pxPerSec, 0);       // and no division by nothing
    assert.equal(p.to, p.from);
  });

  it("survives a song with no running time on it", () => {
    for (const dur of [0, -5, null, undefined, "", "abc"]) {
      assert.equal(scrollPlan(0, 3000, 800, dur).pxPerSec, 0, String(dur));
    }
  });

  it("never scrolls above the top of the page", () => {
    assert.equal(scrollPlan(-500, 3000, 800, 300).from, 0);
  });

  it("keeps the speed override inside something readable", () => {
    assert.equal(clampSpeed(1.1), 1.1);
    assert.equal(clampSpeed(0.1), 0.25);
    assert.equal(clampSpeed(99), 4);
    assert.equal(clampSpeed("nonsense"), 1);
    assert.equal(clampSpeed(undefined), 1);
    assert.equal(clampSpeed(1.0000001), 1);   // rounded, so the readout stays short
  });
});

describe("autoscroll frames", () => {
  const plan = scrollPlan(1000, 3000, 800, 200);   // 2200px over 200s = 11px/s

  it("moves at the song's pace", () => {
    const f = advanceScroll(plan, plan.from, 1, 1);
    assert.equal(Math.round(f.pos), 1011);
    assert.equal(f.done, false);
  });

  it("takes the length of the song to get to the end", () => {
    let pos = plan.from;
    let ticks = 0;
    while (ticks < 1000) {
      const f = advanceScroll(plan, pos, 1, 1);
      pos = f.pos;
      ticks++;
      if (f.done) break;
    }
    assert.equal(ticks, 200);
    assert.equal(pos, plan.to);
  });

  it("stops itself at the end and goes no further", () => {
    const f = advanceScroll(plan, plan.to - 1, 10, 1);
    assert.equal(f.pos, plan.to);
    assert.equal(f.done, true);
    assert.equal(f.progress, 1);
    assert.equal(f.remaining, 0);
    // and a frame after the end stays put rather than running off the page
    assert.equal(advanceScroll(plan, plan.to, 5, 1).pos, plan.to);
  });

  it("honours the speed override", () => {
    const one = advanceScroll(plan, plan.from, 1, 1).pos - plan.from;
    const two = advanceScroll(plan, plan.from, 1, 2).pos - plan.from;
    const half = advanceScroll(plan, plan.from, 1, 0.5).pos - plan.from;
    assert.ok(Math.abs(two - one * 2) < 1e-9);
    assert.ok(Math.abs(half - one / 2) < 1e-9);
    // out-of-range overrides are clamped, not obeyed
    assert.equal(advanceScroll(plan, plan.from, 1, 99).pos, advanceScroll(plan, plan.from, 1, 4).pos);
  });

  it("reports the time left, and shortens it when you speed up", () => {
    assert.equal(Math.round(advanceScroll(plan, plan.from, 0, 1).remaining), 200);
    assert.equal(Math.round(advanceScroll(plan, plan.from, 0, 2).remaining), 100);
  });

  it("picks up from wherever the reader dragged the page to", () => {
    const dragged = advanceScroll(plan, 2000, 1, 1);
    assert.equal(Math.round(dragged.pos), 2011);
    assert.ok(dragged.progress > 0.45 && dragged.progress < 0.46);
    // dragged above the start, it clamps rather than scrolling backwards
    assert.equal(advanceScroll(plan, 0, 0, 1).pos, plan.from);
  });

  it("does nothing for a song that already fits on screen", () => {
    const flat = scrollPlan(0, 500, 800, 200);
    const f = advanceScroll(flat, flat.from, 10, 1);
    assert.equal(f.pos, flat.from);
    assert.equal(f.done, true);
    assert.equal(f.remaining, 0);
  });

  it("shrugs off a junk frame time", () => {
    for (const dt of [-1, NaN, undefined, null, "x"]) {
      assert.equal(advanceScroll(plan, plan.from, dt, 1).pos, plan.from, String(dt));
    }
  });
});

describe("tempo", () => {
  it("keeps a bpm inside what a band can play, or calls it no tempo", () => {
    assert.equal(normBpm(120), 120);
    assert.equal(normBpm("143.6"), 144);
    assert.equal(normBpm(5), 30);          // clamped up
    assert.equal(normBpm(900), 300);       // clamped down
    for (const junk of [0, -1, "", null, undefined, NaN, "fast"]) {
      assert.equal(normBpm(junk), 0, String(junk));
    }
  });

  it("defaults a bar to four beats", () => {
    assert.equal(normBeats(3), 3);
    assert.equal(normBeats(6), 6);
    assert.equal(normBeats(""), 4);
    assert.equal(normBeats(0), 4);
    assert.equal(normBeats(99), 12);
  });

  it("reads the Tempos tab, key or title+artist", () => {
    const map = parseTempos([
      ["riffraff-acdc", "Riff Raff", "AC/DC", "185", "4"],
      ["", "Ramble On", "Led Zeppelin", "100", "6"],
      ["", "", "", "", ""],
    ]);
    assert.deepEqual(map["riffraff-acdc"], { bpm: 185, beats: 4 });
    assert.deepEqual(map[songKey("Ramble On", "Led Zeppelin")], { bpm: 100, beats: 6 });
    assert.equal(Object.keys(map).length, 2);
  });

  it("lets the sheet win, but falls back to the catalog when the cell is blank", () => {
    const song = { name: "Riff Raff", artist: "AC/DC", bpm: 185 };
    const sheet = { "riffraff-acdc": { bpm: 178, beats: 4 } };
    assert.deepEqual(tempoFor(sheet, song), { bpm: 178, beats: 4, source: "sheet" });

    // Blank BPM is not an answer the way a blank tuning is — a click needs a
    // number, so the catalog carries it.
    const cleared = { "riffraff-acdc": { bpm: 0, beats: 3 } };
    assert.deepEqual(tempoFor(cleared, song), { bpm: 185, beats: 3, source: "song" });
    assert.deepEqual(tempoFor({}, song), { bpm: 185, beats: 4, source: "song" });
    assert.equal(tempoFor({}, { name: "Nowt", artist: "Nobody" }).source, "none");
  });

  it("works a tempo out of taps, ignoring the one that lands late", () => {
    const steady = [0, 500, 1000, 1500, 2000];          // 120bpm
    assert.equal(tapTempo(steady), 120);
    assert.equal(tapTempo([0, 500, 1000, 2400, 2900, 3400]), 120);  // one dropped beat
    assert.equal(tapTempo([1000]), 0);
    assert.equal(tapTempo([]), 0);
    assert.equal(tapTempo([0, 0, 0]), 0);
  });

  it("counts bars, accenting beat one", () => {
    assert.deepEqual(barPosition(0, 4), { bar: 1, beat: 1, accent: true });
    assert.deepEqual(barPosition(3, 4), { bar: 1, beat: 4, accent: false });
    assert.deepEqual(barPosition(4, 4), { bar: 2, beat: 1, accent: true });
    assert.deepEqual(barPosition(7, 3), { bar: 3, beat: 2, accent: false });
  });

  it("books the beats due in a window, and never books one twice", () => {
    const plan = beatPlan(120, 4);       // half a second a beat
    assert.equal(plan.spb, 0.5);
    assert.equal(plan.bar, 2);

    const first = beatsDue(plan, 10, 10.6, 10);
    assert.deepEqual(first.map((b) => b.n), [0, 1]);
    assert.equal(first[0].accent, true);
    assert.equal(first[1].beat, 2);

    // The next window starts where the last ended; the beat on the seam is not
    // handed out again.
    const second = beatsDue(plan, 10.6, 11.1, 10);
    assert.deepEqual(second.map((b) => b.n), [2]);
    assert.equal(beatsDue(plan, 11.0, 11.0, 10).length, 0);
    assert.equal(beatsDue(beatPlan(0, 4), 0, 10, 0).length, 0);
    // A tab that slept for an hour comes back to a handful of beats, not 400k.
    assert.ok(beatsDue(plan, 10, 3610, 10).length <= 65);
  });

  it("flashes long enough to see, short enough to leave a gap", () => {
    assert.ok(flashMs(60) <= 110);
    assert.ok(flashMs(200) >= 35);
    assert.ok(flashMs(200) < 60 / 200 * 1000);
    assert.equal(flashMs(0), 0);
  });
});

describe("chords re-flowed for a narrow screen", () => {
  it("keeps every chord over its own syllable", () => {
    const segs = chordWords(
      "E              A        B",
      "Hey ho, let's go, they're forming in a line"
    );
    // Each chord starts a piece, and that piece begins at the chord's column.
    assert.equal(segs[0].chord, "E");
    assert.equal(segs[0].text.startsWith("Hey"), true);
    const line = "Hey ho, let's go, they're forming in a line";
    const a = segs.find((x) => x.chord === "A");
    const b = segs.find((x) => x.chord === "B");
    assert.equal(a.text[0], line[15]);   // the A sits at column 15
    assert.equal(b.text[0], line[24]);   // and the B at column 24
    // Nothing is lost or duplicated on the way through.
    assert.equal(segs.map((x) => x.text).join(""), "Hey ho, let's go, they're forming in a line");
  });

  it("breaks at every word, so a long line wraps instead of running off", () => {
    const segs = chordWords("G", "one two three four");
    assert.equal(segs.length, 4);
    assert.deepEqual(segs.map((x) => x.text), ["one ", "two ", "three ", "four"]);
    assert.deepEqual(segs.map((x) => x.chord), ["G", "", "", ""]);
  });

  it("splits a word that a chord lands inside", () => {
    const segs = chordWords("    D", "roundabout");
    assert.deepEqual(segs, [{ chord: "", text: "roun" }, { chord: "D", text: "dabout" }]);
  });

  it("keeps a chord that hangs past the end of the words", () => {
    const segs = chordWords("A            E   D", "stay clean");
    assert.deepEqual(segs.slice(-2), [{ chord: "E", text: "" }, { chord: "D", text: "" }]);
    assert.equal(segs[0].chord, "A");
  });

  it("handles a riff row with no words under it at all", () => {
    assert.deepEqual(chordWords("|A5 |A5 | 8x", ""), [
      { chord: "|A5", text: "" }, { chord: "|A5", text: "" },
      { chord: "|", text: "" }, { chord: "8x", text: "" },
    ]);
  });

  it("passes a plain lyric line straight through", () => {
    assert.deepEqual(chordWords("", "just the words"), [{ chord: "", text: "just the words" }]);
    assert.deepEqual(chordWords("", ""), []);
    assert.deepEqual(chordWords(null, undefined), []);
  });
});


/* ---------- added with the merge ---------- */

function pr(k, e, tags = [], extra = {}) {
  return { k, song: k, artist: extra.artist || k, lead: extra.lead || "V1", e, tags, score: extra.score || 0 };
}

describe("October's pacing engine", () => {
  it("puts the opener first and the closer last", () => {
    const list = [pr("a", 3), pr("close", 5, ["closer"]), pr("b", 4), pr("open", 5, ["opener"]), pr("c", 4)];
    const out = orderPacing(list).map((s) => s.k);
    assert.equal(out[0], "open");
    assert.equal(out[out.length - 1], "close");
  });

  it("never finishes on a slow song when a hot one is available", () => {
    const list = [];
    for (let i = 0; i < 9; i++) list.push(pr("hot" + i, 4 + (i % 2)));
    list.push(pr("ballad", 1, ["ballad"]));
    const out = orderPacing(list).map((s) => s.k);
    assert.ok(!out.slice(-3).includes("ballad"));
    assert.ok(!out.slice(0, 3).includes("ballad"));
  });

  it("keeps two songs by one artist apart when it can", () => {
    const list = [
      pr("a1", 4, [], { artist: "A" }), pr("a2", 4, [], { artist: "A" }),
      pr("b", 4, [], { artist: "B" }), pr("c", 4, [], { artist: "C" }), pr("d", 4, [], { artist: "D" }),
    ];
    const out = orderPacing(list);
    for (let i = 1; i < out.length; i++) assert.notEqual(out[i].artist === "A" && out[i - 1].artist === "A", true);
  });

  it("returns every song exactly once", () => {
    const list = ["a", "b", "c", "d", "e", "f"].map((k, i) => pr(k, 1 + (i % 5), i === 2 ? ["dip"] : []));
    assert.deepEqual(orderPacing(list).map((s) => s.k).sort(), ["a", "b", "c", "d", "e", "f"]);
  });
});

describe("songMeta: a curated row is taken exactly as written", () => {
  it("uses the sheet's energy and tags, blank tags included", () => {
    assert.deepEqual(songMeta({ song: "Jump", artist: "Van Halen", energy: 2, tags: [] }), { e: 2, tags: [] });
  });
  it("falls back to the built-in map only for an uncurated row", () => {
    assert.deepEqual(songMeta({ song: "Jump", artist: "Van Halen", energy: 0, tags: [] }), { e: 4, tags: ["opener"] });
  });
  it("'-' clears the built-in tags on an uncurated row", () => {
    assert.deepEqual(songMeta({ song: "Jump", artist: "Van Halen", energy: 0, tags: ["-"] }), { e: 4, tags: [] });
  });
  it("an unknown song defaults to energy 3", () => {
    assert.deepEqual(songMeta({ song: "Nope", artist: "Nobody", energy: 0, tags: [] }), { e: 3, tags: [] });
  });
});

describe("runningOrder", () => {
  const rows = [
    { k: "a", song: "a", artist: "A", len: "3:00", energy: 4, tags: [], votes: {}, order: 0 },
    { k: "b", song: "b", artist: "B", len: "3:00", energy: 5, tags: ["opener"], votes: {}, order: 0 },
    { k: "c", song: "c", artist: "C", len: "3:00", energy: 4, tags: [], votes: {}, order: 0 },
  ];
  it("is automatic when nothing is saved", () => {
    const r = runningOrder(rows, { engine: "pacing" });
    assert.equal(r.mode, "auto");
    assert.equal(r.order[0], "b");
  });
  it("follows a saved order, with unplaced songs closing up at the end", () => {
    const saved = rows.map((r) => ({ ...r, order: r.k === "c" ? 1 : r.k === "a" ? 2 : 0 }));
    const r = runningOrder(saved, { engine: "pacing" });
    assert.equal(r.mode, "saved");
    assert.deepEqual(r.order, ["c", "a", "b"]);
  });
  it("the curve engine also opens on the opener", () => {
    const r = autoOrder(rows, { engine: "curve" });
    assert.equal(r[0], "b");
    assert.equal(r.length, 3);
  });
});

describe("scoreRow", () => {
  it("weights MUST/YES/MAYBE/NO and counts pick-ONE marks apart", () => {
    const v = { A: "MUST", B: "NO", C: "X", D: "MAYBE" };
    assert.deepEqual(scoreRow(v, ["A", "B", "C", "D"]), { score: 3, musts: 1, xs: 1 });
  });
});

describe("readiness", () => {
  it("counts each player's stages and the songs the whole band knows", () => {
    const rows = [
      { learn: { A: "KNOW", B: "KNOW" } },
      { learn: { A: "KNOW", B: "IN PROGRESS" } },
      { learn: { A: "NOT STARTED" } },
    ];
    const r = readiness(rows, ["A", "B"]);
    assert.equal(r.allKnow, 1);
    assert.deepEqual(r.per.A, { know: 2, progress: 0, notStarted: 1, unanswered: 0 });
    assert.deepEqual(r.per.B, { know: 1, progress: 1, notStarted: 0, unanswered: 1 });
  });
});
