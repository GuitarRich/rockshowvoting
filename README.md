# Setlist — one app for every show

A band votes on a setlist, learns it, rehearses it and plays it. This app does all of that for as many shows as you like, from one Google Sheet. Nobody has an account.

Hosted on Vercel. The pages are static; the serverless functions in `api/` talk to the sheet with a Google service account. **The sheet is the source of truth**: adding a song, a person or a show never needs a code change or a deploy.

## Pages

Every page takes `?show=<id>`. A link with no show opens the next show by gig date.

| Page | What it is |
|---|---|
| `vote.html` | The ballot. One song at a time (with a track list on a desktop) or the whole list. Must play / Yes / Maybe / Pass, pick-one groups, organiser-locked songs. |
| `setlist.html` | The set, the full ranking with why each song missed, who voted what, band readiness, and Tools (vote pooling, CSV export, storage check). Owner controls: song count, In/Out, drag reorder, lock. |
| `learn.html` | Who knows what: each player marks songs Not started / In progress / Know it. |
| `lyrics.html` | The lyric book: words and chords in set order, chord shapes in the song's tuning, autoscroll, print. |
| `click.html` | The click track: a flashing lamp and a click at the song's tempo, tap tempo, saved per song. |
| `availability.html` | Rehearsal calendar up to the gig. |
| `admin.html` | Songs (add, bulk paste, edit, remove), the show's settings, and starting a new show. |

`index.html` and `results.html` are October's original ballot and results pages, kept unchanged until its gig on 24 Oct 2026. They send any other show to `vote.html` / `setlist.html`, and retire afterwards.

## Shows

The `Shows` tab lists every show: `Id, Prefix, Name, GigDate, Status, RequireBandCode`.

- Each show's own tabs are named with its prefix: November's votes live on `nov·Votes`. October's prefix is empty, so it kept its original tab names.
- `Status` `past` makes a show read-only.
- Start a new show from the admin page ("Start a new show"). Copying from an earlier show brings its songs and settings, never its votes.

### Per-show tabs

| Tab | Holds |
|---|---|
| `Songs` | Key, Section, Song, Artist, Lead, Length, Energy, Tags, Order, Force, Keyboard, Year, Era |
| `Votes` | One row per person: their ballot as JSON (`MUST/YES/MAYBE/NO`, `X` for a pick-one choice) |
| `Learning` | One row per person: practice status as JSON |
| `Availability` | One row per player: days as JSON keyed `YYYY-MM-DD` |
| `Settings` | Key/value — see below. Hand-editable. |
| `Grid` | Derived, human-readable. Rewritten on every save; never edit it. |

### Settings (per show)

`showName`, `occasion`, `bandName`, `owner`, `gigDate`, `voters` and `band` (JSON lists — the band must also be voters), `maxSongs` (0 = use the time budget), `budgetSeconds` (0 = no clock), `gapSeconds`, `maxPerArtist` (0 = no limit), `orderEngine` (`pacing` or `curve`), `tieBreak` (`energy` or `shorter`), `warnings`, `leads`, `eras`, `locked`, `lockedKeys`. A missing key falls back to its default.

The lists are the only authority on who counts. Taking a name off stops that person counting but deletes nothing; putting it back restores them.

### Library tabs (shared by every show)

| Tab | Holds |
|---|---|
| `Lyrics` | Key, Song, Artist, Lyrics. Pasted by the band; nothing is fetched from a lyrics site. |
| `Tempos` | Key, Song, Artist, BPM, BeatsPerBar. A blank BPM falls back to the library's estimate. |
| `Tunings` | Key, Song, Artist, Tuning. A row's presence is authoritative — a blank cell means E standard. |
| `Library` | Song facts (length, year, era, bpm estimate, energy, tags, lead, keys). A song added to a show fills its blanks from here, and edits flow back. |

A song played again at a later show keeps its words, tempo and tuning.

## Codes

Two shared codes. Neither is a login; they stop a stranger with the link writing to the sheet, and a bandmate changing the set by accident.

| Env var | Needed for |
|---|---|
| `BAND_SECRET` | Every save on a show with `RequireBandCode` TRUE. Asked once per device. |
| `OWNER_SECRET` | Changing the set, the songs, the settings, creating shows, pooling others' votes. Falls back to `APP_SECRET` if unset. |

Typing the owner's name grants nothing — only the owner code does.

## Scoring and the set

Must play **+6**, Yes **+2**, Maybe **+1**, Pass **−4** (a veto: outweighs two Yeses), blank 0. Weights live in `setlist.js`.

**Selection is pure score**, worked out once on the server so every page agrees:

1. Force OUT beats everything; force IN is always in; a locked snapshot stays put; then the vote.
2. Forced songs, then LOCKED sections, then one song per pick-ONE group, then the rest by score.
3. A negative total never goes in. At most `maxPerArtist` per artist. Stop at `maxSongs`, or at the time budget.
4. A song with an unreadable Length blocks a time-budgeted set rather than letting the cap silently switch off.

**Ordering is a separate pass**: the saved Order if the owner set one, otherwise the show's engine — `pacing` (best fit to a set shape with protected ends; knows `opener`, `closer`, `heavy`, `ballad`, `dedication`, `lift`, `dip`) or `curve` (Band Vote's seed-and-repair on one cost table; also knows `slow`).

Warnings (vocal balance, flat stretches, long runs for one voice, no dedication, why songs missed) are flagged per show and never overrule the vote.

**A curated row** (one with an Energy value) uses its Tags exactly, blank included. `-` in Tags forces "no tags" on an uncurated row.

### The Length gotcha

Google Sheets turns `3:23` into a time value. The API reads displayed text and accepts `m:ss`, `h:mm:ss` and `3:23:00 AM`, treating anything over 15 minutes as unreadable. If a set refuses to build: select the Length column, Format → Number → Plain text, and retype the values.

## Run it

**Offline, no credentials** — the usual way to work on the UI:

    pnpm install
    pnpm dev            # http://localhost:8900 — real API code on an in-memory sheet with both shows
    pnpm test           # engine, API handlers, migration, October parity

Band code `band`, owner code `owner`.

**Against the real sheet**:

    pnpm run env:pull   # vercel env pull (production) → .env.development.local, gitignored
    pnpm dev:real       # vercel dev
    pnpm backup         # duplicate every tab to hidden bak-YYYYMMDD·<Tab> — run before any scripted write

## Setup (once)

1. Google Cloud service account with the Sheets API enabled; download its JSON key. Never commit it.
2. Share the sheet with the service account's email as an **Editor**.
3. In Vercel set `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (whole key, BEGIN/END included), `SHEET_ID`, `BAND_SECRET`, `OWNER_SECRET`. Redeploy — env changes do not reach an existing build.
4. Open `/api/health`: `ok: true`, every show's tabs listed, and no `warning`.

Missing tabs and headers are created on first request.

## History

- **v33** — one app for every show. Bun's & Roses (the Band Vote app, v32) moved in as the November show with its votes, set, learning, lyrics, tempos and tunings; `scripts/migrate-bandvote.js` did the move (dry run, apply, verify). The spec, plan and task list are in `specs/001-reusable-show-app/`.
- `apps-script.gs` is the retired original backend, kept for reference.
