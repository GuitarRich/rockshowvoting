---
description: "Task list for the Reusable Show App (Band Vote parity + Rock Show extras, multi-show)"
---

# Tasks: Reusable Show App

**Input**: Design documents from `specs/001-reusable-show-app/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: These are INCLUDED. FR-028 requires automated tests, and plan.md makes the October parity test a gate before every Phase 1 push.

**Organization**: Tasks are grouped by user story. The phases run in **delivery order** (November first, lyrics as early as possible, as plan.md says), not in strict spec priority order. Each story phase still stands on its own.

## Conventions for whoever runs these tasks

- **Repo root and references**:
  - The repo root is `/Users/richard.seal/Projects/rock show`. All paths below are relative to it.
  - The **Band Vote** reference repo is `/Users/richard.seal/Projects/band vote`, written below as `BV:`.
  - Read the BV file before porting it. Copy its behaviour, and adapt its data access to this repo's API (contracts/api.md).
- **Tools and commits**:
  - pnpm only; never npm or yarn.
  - Commit straight to `main` after each checkpoint.
  - Run `pnpm test` before every push. The October parity test (T010) must pass.
- **The live sheet**:
  - **NEVER write to the live sheet** except through a task that says so explicitly, and only after T008's backup has been run that same day.
  - **NEVER write to the Band Vote sheet** `14nIIefs1Jks8kaU2YzuSLbpuXPDQqzW-zt4asu5TYS0`.
- **Secrets**: never ask for secrets in chat. Env vars go in the Vercel dashboard, and the owner sets them.
- **Show selection**: a request with no `show` MUST behave exactly like today's October app.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Tooling, tests, and a dev server that doesn't touch the live sheet.

- [X] T001 Update `package.json`:
  - Add `"packageManager": "pnpm@10.14.0"`.
  - Add these scripts:
    - `"test": "node --test test/"`
    - `"dev": "node dev-server.js"`
    - `"dev:real": "vercel dev"`
    - `"env": "vercel env pull .env.development.local"`
    - `"backup": "node scripts/backup-sheet.js"`
    - `"migrate:nov": "node scripts/migrate-bandvote.js"`
  - Keep the `googleapis` dependency.
  - Run `pnpm install`.
- [X] T002 [P] Create the directories `test/`, `test/fixtures/`, `scripts/` and `scripts/fixtures/`. Add `test/fixtures/.gitkeep`.
- [X] T003 [P] Extend `.gitignore` with `.env.development.local` and `scripts/out/`. Check that the service-account JSON pattern `bunsnroses-*.json` is already covered.
- [X] T004 Create `test/fakeSheets.js`, an in-memory Google Sheets v4 client that can be passed to `setSheetsClient()` from `api/_sheets.js`.
  - Support the calls `api/_sheets.js` makes:
    - `spreadsheets.get` (sheet titles)
    - `spreadsheets.batchUpdate` (addSheet, duplicateSheet, updateSheetProperties)
    - `spreadsheets.values.get`, `.update`, `.append`, `.clear`, `.batchGet` and `.batchUpdate`, using A1 ranges
  - Return displayed values as strings, the way Sheets does.
  - Add an option `timeCells: true` that turns `m:ss` values into `3:23:00 AM` strings, so the unreadable-length path gets tested.
  - Export `makeFakeSheets(initialTabs)` and `snapshot()`.
- [X] T005 [P] Create `test/helpers.js`, which calls API handlers directly. Export `call(handler, {method, query, body})`, which fakes `req` and `res` and returns `{status, json, headers}`. Set `process.env.SHEET_ID = "test"` and the fake secrets `BAND_SECRET="band"` and `OWNER_SECRET="owner"`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**:
- the October safety net;
- show-aware storage, codes, library tabs and the shared engine;
- November migrated into the sheet.

Every story below depends on this phase.

**⚠️ CRITICAL**: No user story work begins until this phase is complete. T010 must be green before anything is pushed.

### October safety net

- [X] T006 Write `scripts/capture-oct-payload.js`, which GETs `https://<prod-domain>/api/data` (the URL comes from argv) and writes `test/fixtures/oct-payload.json`. Also write `test/fixtures/oct-sheet.json`, rebuilt from that payload as raw tab rows for `fakeSheets` (tabs: Songs, Votes, Learning, Availability, Tunings, Settings). Ask the owner for the production URL, or read it from `.vercel/project.json` and `vercel ls`, then run the script once.
- [X] T007 [P] Write `scripts/backup-sheet.js`.
  - For every tab in `SHEET_ID`, call `duplicateSheet` into a hidden tab named `bak-YYYYMMDD·<Tab>`.
  - Skip tabs that already start with `bak-`. If today's backup already exists, skip it.
  - Print the list.
  - Use the credentials in `.env.development.local` (loaded with `node --env-file`).
- [X] T008 Run `pnpm run env:pull`, then `pnpm backup` against the live sheet. **This is the first live write**, and it only duplicates tabs. Record the tab list in `scripts/out/backup-log.txt`.
- [X] T009 Write `test/october.test.js`.
  - Load `test/fixtures/oct-sheet.json` into `fakeSheets` and call `api/data.js` with no `show` param.
  - Assert that every field present in `test/fixtures/oct-payload.json` is deep-equal in the new response. Extra fields are allowed.
  - Also call `api/vote.js` with no `show` and no `code` for voter "Rich", and assert 200. This checks October still needs no band code.
- [X] T010 Run `pnpm test`. T009 must pass against the **unchanged** code before any refactor starts. This is the baseline.

### Shows registry and prefixed tabs

- [X] T011 In `api/_sheets.js`, add the Shows registry.
  - Add `SHOWS_TAB = "Shows"` with the headers `Id, Prefix, Name, GigDate, Status, RequireBandCode`.
  - `ensureShows()` creates the tab if it is missing and seeds the row `oct, "", October Anniversary Show, <Settings.gigDate>, current, FALSE`.
  - Export `readShows()`, which returns `[{id, prefix, name, gigDate, status, requireBandCode}]`.
  - Export `resolveShow(id)`. With no `id` it returns `oct`. An unknown `id` throws an error with `status = 404`.
  - Export `defaultShowId(shows, today)`, following the rule in data-model.md "Shows".
- [X] T012 Refactor `api/_sheets.js` so every show-scoped tab constant (`Songs, Votes, Learning, Availability, Settings, Grid`) is resolved through `tab(show, name) => show.prefix + name`.
  - Change `ensureTabs(show)`, `readAll(show)`, `writeVoter(show, …)`, `writeLearner(show, …)`, `writeAvailability(show, …)`, `writeSettings(show, …)`, `writeSongs(show, …)` and `writeGrid(show, …)` to take `show` as the first argument.
  - `Tunings` stays unprefixed.
  - Update all callers in `api/*.js` to pass `await resolveShow(req.query.show || body.show)`.
  - Run T009. It must still pass.
- [X] T013 In `api/_sheets.js`, extend the Songs headers to the right with `Year, Era`. This only adds columns: `ensureTabs` must append the missing headers and never rewrite existing ones. Read them into `row.year` and `row.era`, and default both to `""`.
- [X] T014 In `api/_sheets.js`, add the per-show settings keys from data-model.md "Show Settings":
  - The keys are `showName, occasion, bandName, voters, band, owner, budgetSeconds, gapSeconds, maxPerArtist, warnings, leads, eras`.
  - Parse JSON values safely; invalid JSON falls back to the default.
  - The defaults come from the current constants in `setlist.js` (`VOTERS`, `BAND`, `MAX_PER_ARTIST`) and in `api/_selection.js` (`TARGET`, `GAP`), so October's behaviour doesn't change.
  - `readAll(show)` returns `state.settings` with every key filled in.
- [X] T015 In `api/_selection.js`, change `selectSet(rows, roster, opts)` to take `opts.budgetSeconds`, `opts.gapSeconds` and `opts.maxPerArtist`. When one is missing, use today's constant. Update `api/_payload.js` to pass the values from `state.settings`.
- [X] T016 In `api/_payload.js`, `rosterOf()` and the band filtering read `state.settings.voters` and `state.settings.band` instead of the `VOTERS` and `BAND` imports.
  - Change `api/vote.js`, `api/learn.js` and `api/availability.js` so name checks use the show's lists.
  - Update the error text so it says to add the name in the show's Settings tab.
- [X] T017 [P] Write `test/api.shows.test.js`, using fakeSheets with `Shows` rows for `oct` (prefix "") and `nov` (prefix `nov·`). Assert:
  - With no `show`, `data.js` reads the unprefixed tabs.
  - `show=nov` reads the `nov·Songs` and `nov·Votes` tabs.
  - A vote for `nov` writes only to `nov·Votes`.
  - An unknown show gets 404.
  - `defaultShowId` picks the soonest upcoming current show.

### Codes and read-only past shows

- [X] T018 Create `api/_auth.js` with the following exports. They check the rules in contracts/api.md "Codes".
  - `requireBand(show, body)`:
    - If `show.requireBandCode`, then `body.code` must equal `process.env.BAND_SECRET` once quotes and whitespace are stripped. Otherwise the error has status 401 and the message "Wrong band code.".
    - If `BAND_SECRET` is unset and the show requires a code, the error has status 500 and the message "BAND_SECRET is not set.".
  - `requireOwner(body)`: `body.ownerCode ?? body.key` must equal `OWNER_SECRET || APP_SECRET`. Otherwise the error has status 403 and the message "Wrong owner code.".
  - `requireWritable(show)`: if `show.status === "past"`, the error has status 409.
- [X] T019 Wire `api/_auth.js` into every POST handler:
  - `api/vote.js`, `api/learn.js` and `api/availability.js` call requireWritable and requireBand.
  - `api/admin.js` calls requireWritable and requireOwner. Replace its inline `APP_SECRET` check, and keep accepting `key` so October's admin page still works.
  - Use `fail(res, e.status || 500, e.message)`.
- [X] T020 [P] Write `test/api.auth.test.js`. Assert:
  - An `oct` vote with no code gets 200.
  - A `nov` vote with no code gets 401; with `code:"band"` it gets 200.
  - Admin with `key:"owner"` gets 200; with `ownerCode:"owner"` gets 200; with the wrong code gets 403.
  - When `Shows.Status=past`, any POST gets 409.
  - A voter who types the name "Rich" without an owner code cannot call admin.

### Library tabs

- [X] T021 In `api/_sheets.js`, add the library tabs, all unprefixed and keyed by `songKey`:
  - `LYRICS_TAB = "Lyrics"`, with headers `Key, Song, Artist, Lyrics`
  - `TEMPOS_TAB = "Tempos"`, with headers `Key, Song, Artist, BPM, BeatsPerBar`
  - `LIBRARY_TAB = "Library"`, with headers `Key, Song, Artist, Length, Year, Era, Bpm, Energy, Tags, Lead, Keyboard`
  - `ensureTabs` creates them.
  - Export:
    - `readLyrics(keys?)`
    - `writeLyric({key, song, artist, lyrics})`, which upserts one row and rejects more than 20,000 characters
    - `addBlankLyricRows(songs)`
    - `readTempos()`
    - `writeTempo({key, song, artist, bpm, beats})`, which upserts one row
    - `readLibrary()`
    - `upsertLibrary(rows)`, which only appends or updates the rows it is given
  - Follow BV:`api/_sheets.js` for the lyrics and tempos read and write logic. Match the blank rules in data-model.md "Library song content".
- [X] T022 In `api/_payload.js`, add these to each row:
  - `bpm`, `beats` and `bpmSource`:
    - `"set"` when there is a Tempos row with a BPM;
    - `"est"` when only `Library.Bpm` has one;
    - `"none"` otherwise.
  - `hasLyrics`, `year`, `era`.
  - `cut`, with one of the values `veto | cap | room | out | null`, taken from `selectSet`'s reasons. Extend `api/_selection.js` to return a `cut` map.
  - At the top level, add `show: {id, name, occasion, bandName, owner, gigDate, status, requireBandCode}` and `settings: {…}`.
  - Also add `set.order`, the list of song keys in running order. It uses the saved Order, or else the automatic order from the shared engine (T025).
- [X] T023 [P] Create `api/lyrics.js`.
  - GET `?show=&all=` returns `{lyrics: {key: text}}` for the songs in the set, or for every ballot song when `all=1`.
  - POST `{show, code, key, lyrics}` calls requireWritable and requireBand, resolves the key with `keyResolver`, then calls `writeLyric`.
  - POST `{addBlankRows: true}` calls `addBlankLyricRows` for the songs in the set.
  - Use the `ok`/`fail`/`methodGuard` envelope. GET and POST are both allowed, so branch on the method.
- [X] T024 [P] Create `api/tempos.js`, which accepts POST only with the body `{show, code, key, bpm, beats}`.
  - Check the codes with requireBand.
  - Validate `bpm` as an integer from 30 to 300, and `beats` as an integer from 2 to 7.
  - Save with `writeTempo`.
  - Return the fresh `bpm`, `beats` and `bpmSource`.

### Shared engine (ported from Band Vote)

- [X] T025 Merge the following BV:`setlist.js` functions into `setlist.js`, and export them. Keep every existing export unchanged.
  - Ordering:
    - Port `targetEnergy`, `seedOrder`, `orderCost`, `repairOrder`, `orderSet`, `applySavedOrder`, `moveKey`, `isSlow`, `tagsOf` and `energyOf`.
    - Extend them with Rock Show's tags `heavy`, `lift` and `dip`, following the tag windows in the rock show `results.html` `orderSet`, and add the rule "same artist adjacent +10".
    - Keep all the penalty weights in one `PENALTIES` object.
  - Lyrics and chords: the lyrics parsing, chord-line detection and ChordPro conversion, and the phone chord wrapping.
  - Tempo and autoscroll: the autoscroll maths, and the tempo, tap and beat-scheduling helpers (`normBpm`, `normBeats`, tap averaging).
  - Tunings: the tuning-name normalising.
  - Rock Show uses string votes (MUST, YES, MAYBE, NO), and its `setlist.js` already defines `voteWeight`. Keep that one; don't import BV's numeric vote functions.
- [X] T026 [P] Copy BV:`chords.js` to `chords.js` unchanged. Check that it only imports what `setlist.js` now exports.
- [X] T027 Port the non-vote tests from BV:`setlist.test.js` into `test/engine.test.js`:
  - ordering, saved order, `moveKey`
  - `parseLen`, era
  - tunings, lyrics, escaping
  - chord lines, ChordPro, chord shapes
  - autoscroll, tempo, tap and beat scheduling
  - phone chord wrapping
  Adapt the imports and add cases for `heavy`, `lift`, `dip` and the same-artist penalty. Every test must pass.
- [X] T028 [P] Copy BV:`app.css` to `app.css`. Then:
  - Take the "Bun's & Roses" wording out of its comments.
  - Add the CSS custom properties that the October pages use inline (`--all`, `--one`, `--few` and the vote colours), so later pages can share them.

### November migration (Band Vote → `nov`)

- [X] T029 Create `scripts/fixtures/bandvote-tracks-v32.json`, a frozen copy of the `TRACKS` array from BV:`catalog.js` at v32, with all 73 entries in order. Each entry is `{i, name, artist, seconds, year, bpm, era, energy, tags, lead}`. Build it by importing BV:`catalog.js` from a one-off node command, and commit the JSON.
- [X] T030 Create `scripts/lib/bandvote-map.js`, with pure functions (no I/O):
  - `keyMap(tracks, addedRows)` returns `Map` from `b<i>` or an added key to `songKey`.
  - `mapVote(n)` maps `3→MUST`, `2→YES`, `1→MAYBE` and `0→NO`; anything else maps to `null`.
  - `mapProgress(s)` maps `know-it→KNOW`, `in-progress→IN PROGRESS` and `not-started→NOT STARTED`.
  - `mapState(s)` maps `in→IN` and `out→OUT`.
  - `secsToMmss(n)`.
  - `crossCheck(rowsWithTitleArtist, keyMap)` throws an error listing every row whose Title/Artist doesn't match the key it maps to.
  - `buildNovTabs(source)` returns the rows for `nov·Songs`, `nov·Votes`, `nov·Learning` and `nov·Settings`, plus the Library, Lyrics, Tempos and Tunings additions. It follows the table in data-model.md "Migration mapping".
- [X] T031 [P] Write `test/migrate.test.js` against fixture excerpts of the Band Vote tabs. Check:
  - the key map for `b0`, `b72` and an added song;
  - that `crossCheck` fails on a deliberately wrong title;
  - every value transform;
  - that Tunings clashes keep the existing value and are reported;
  - that `buildNovTabs` output round-trips through `readAll({prefix:"nov·"})` using fakeSheets.
- [X] T032 Create `scripts/migrate-bandvote.js`.
  - **Modes and access:**
    - It has three modes: the default dry run, `--apply` and `--verify`.
    - It reads the source sheet `14nIIefs1Jks8kaU2YzuSLbpuXPDQqzW-zt4asu5TYS0` with a **read-only** scope (`spreadsheets.readonly`). It uses a separate client, so writing to the source is impossible.
    - It first checks it can access the source. On a 403, print: "Share the Band Vote sheet with <service account email> as Viewer".
  - **Dry run** writes `scripts/out/nov-migration-report.md` with:
    - the key map, and any row that isn't mapped;
    - the number of songs and added songs;
    - the vote count for each voter;
    - learning counts for each member;
    - the lyric and tempo counts;
    - tuning clashes;
    - the set computed with `selectSet` (limit and cap 1), next to Band Vote's own set computed from BV `selectSet` logic on the same data.
  - **`--apply`**:
    - Refuse unless a backup from today exists (it checks for `bak-YYYYMMDD·` tabs).
    - Create the `Shows` row: `nov`, `nov·`, "Bun's & Roses", GigDate blank, `current`, `TRUE`.
    - Write the `nov·*` tabs. Upsert the Library, Lyrics and Tempos rows, and append the Tunings rows.
  - **`--verify`** reads back both sheets and exits non-zero on any mismatch (SC-008).
- [X] T033 Run `pnpm migrate:nov` as a dry run. **STOP. Show the owner `scripts/out/nov-migration-report.md` and wait for explicit approval.** Ask the owner for November's gig date and venue name, so they can go into `Shows.GigDate` and `nov·Settings.occasion`.
- [X] T034 After approval, run `pnpm backup`, then `pnpm migrate:nov -- --apply`, then `pnpm migrate:nov -- --verify`. Paste the verify output into `scripts/out/nov-migration-verify.txt`. Check the Band Vote sheet's tab row counts are unchanged.

**Checkpoint**:
- October is unchanged (T009 green).
- The November data lives in the sheet under `nov·`.
- The API serves `?show=nov`.
- Commit and push.

---

## Phase 3: User Story 5 — Lyric book and chord help (Priority: P2, delivered first per the user's request) 🎯 MVP

**Goal**: Band members can paste and read November lyrics with chords, chord diagrams, autoscroll and print right away. October gets the same page for free.

**Independent Test**:
1. Open `/lyrics.html?show=nov` and enter the band code.
2. Paste lyrics that include chords into one song and save.
3. Reload: the lyrics are still there.
4. Tap a chord: the diagram uses that song's tuning.
5. Run autoscroll, then print.

### Tests for User Story 5

- [X] T035 [P] [US5] Write `test/api.lyrics.test.js`. Assert:
  - Saving with no band code for `nov` gets 401.
  - A save with the code upserts exactly one `Lyrics` row.
  - Text over 20,000 characters gets 400.
  - A `GET` returns lyrics only for the songs in the set, unless `all=1` is set.
  - Lyrics saved under `nov` are also returned for `oct` when the same song key is in October's set, because lyrics belong to the library.

### Implementation for User Story 5

- [X] T036 [US5] Create `store.js`, adapted from BV:`store.js`. Keep only what the ported pages need:
  - `currentShowId()`: the `?show=` value, else `/api/shows`'s `defaultId`.
  - `getData(show)`: calls `/api/data`.
  - Band code handling:
    - `bandCode()` reads `localStorage` key `rs_code`, and `setBandCode(code)` stores it.
    - `bandCode()` is called only when `data.show.requireBandCode` is true.
    - A 401 clears the stored code and shows the code form again.
  - The name: `me()` and `setMe(name)`, using the `localStorage` key `setlist.me` that is already shared with `learn.html`.
  - Saving:
    - `saveLyric(show, key, text)`
    - `saveTempo(show, key, bpm, beats)`
    - `post(path, body)`, which adds `show` and `code` to every request.
  - The escape helper `esc`.
  - Wrap every `localStorage` access in `try`/`catch`.
- [X] T037 [US5] Create `lyrics.html`, ported from BV:`lyrics.html`.
  - Adapt it to this app:
    - Use `store.js` and `/api/data` plus `/api/lyrics`, with songs from `data.rows` in `data.set.order`.
    - Header: `data.show.bandName || data.show.name`.
    - The copy-text title is `${bandName||name} — LYRIC BOOK`.
    - Use `row.tuning` for chord diagrams and `row.len` for the autoscroll duration.
    - Use `app.css`.
  - Keep every BV feature:
    - the cover and contents
    - per-song paste and save, and "Add blank rows"
    - the "N of M songs still need words" count
    - Genius and Ultimate Guitar lookup links
    - chord rendering, including bars, repeats and ChordPro
    - chord popups
    - autoscroll controls and keys
    - the back-to-top button
    - print CSS
    - copy as text
  - Replace the "Open the setlist first" gate with a name and band-code prompt that shows only when `requireBandCode` is on. Reading needs no code; saving does.
- [X] T038 [US5] Add a "Lyrics" link to the nav of `learn.html`, `availability.html`, `results.html` and `index.html`, keeping the current `?show` param. For October this only adds a link; nothing else changes.
- [X] T039 [US5] Add `lyrics.html` routes to the smoke checks in `quickstart.md` §1 and §4, if they aren't already listed. Test the page by hand on a phone-width viewport of 375px: chords over syllables, and no horizontal scrolling.

**Checkpoint**:
- November lyrics can be entered live.
- Push and deploy.
- Tell the owner to set `BAND_SECRET` and `OWNER_SECRET` in Vercel (Production + Preview) and redeploy. The owner does not paste the values in chat.
- Run quickstart §4 steps 1–2.

---

## Phase 4: User Story 2 — Vote on the setlist (Priority: P1)

**Goal**: November voters get Band Vote's one-song-at-a-time ballot, with a list toggle. October's ballot keeps its behaviour and gains nothing it doesn't ask for.

**Independent Test**: As a November voter, score 10 songs one at a time, reload, and check the page resumes where you stopped and the sheet holds the votes. On October's ballot, run the same save and see no code prompt.

### Tests for User Story 2

- [X] T040 [P] [US2] Add these tests to `test/api.shows.test.js`:
  - A `nov` vote is only accepted from a name in `nov·Settings.voters`.
  - The name is stored under the list's spelling.
  - An empty string clears a vote.
  - Votes on LOCKED songs are ignored, except in pick-one sections.

### Implementation for User Story 2

- [X] T041 [US2] Add a one-at-a-time ballot view to `index.html`, ported from BV:`index.html`.
  - It is the default view when the show's `requireBandCode` is true (November). A "List view" toggle switches to the existing sectioned list.
  - The one-at-a-time view has:
    - a track card showing N of M, the current vote, title, artist, length, year, bpm, era and tuning;
    - the four vote buttons, labelled with `data.weights`;
    - Previous, Skip/Next, Next unscored and Clear;
    - a progress bar with "x / N scored";
    - a desktop track list (hidden under 1100px);
    - a "picked up where you left off" message on return.
  - It saves each vote as `POST /api/vote {show, code, voter, votes: {[k]: value}}`.
  - LOCKED rows and pick-one groups are shown as they are in the list view.
- [X] T042 [US2] Make `index.html` show-aware.
  - Replace the hardcoded title, subtitle and "Max two songs per band" text with `data.show.name`, `data.show.occasion` and `data.settings.maxPerArtist`.
  - Voter buttons come from `data.voters`.
  - The footer gauge uses `data.settings.budgetSeconds` and `gapSeconds`, or, when `set.maxSongs > 0`, shows "N of maxSongs songs".
  - Keep the offline `LOCKED`, `PICKS` and `SONGS` fallback arrays for `oct` only. They are removed in Phase 14 (T088).
  - Update `index.html`'s fallback `VOTERS` to replace CJ with Ethan.
- [X] T043 [US2] Add band-code entry to `index.html` using `store.js`.
  - Prompt for the code only when `requireBandCode` is true. A wrong code sends you back to the gate with a message.
  - If saving fails, run the existing copy-my-votes fallback, and replace the "send it to Rich" text with `data.show.owner`.

**Checkpoint**: The November ballot is live. October's ballot passes T009. Push.

---

## Phase 5: User Story 3 — Build, control and share the set (Priority: P1)

**Goal**: November's set page offers everything Band Vote's did (song-count stepper, In/Out, drag reorder, readiness panel, ranking with cut reasons, copy setlist). The owner code gates every control. Warnings are configured per show.

**Independent Test**:
1. With seeded votes, set the song count to 12.
2. Force one vetoed song in and one high scorer out.
3. Lock the set.
4. Change a vote.
5. The set doesn't move, apart from the forced changes.
6. Every control fails without the owner code.

### Tests for User Story 3

- [X] T044 [P] [US3] Write `test/selection.test.js`.
  - Check the precedence: OUT > IN > lock > vote.
  - Check that songs with a negative total are excluded, the cap is applied with forced songs counting toward it, and the set stops at the count or the budget.
  - Check `blocked` and `badLengths` when a length is unreadable and `maxSongs` is 0.
  - Check that `cut` reasons are filled in.
  - Check that with `nov` settings (cap 1, count-driven), selecting from a fixture of Band Vote votes gives the same set as BV's `selectSet`.

### Implementation for User Story 3

- [X] T045 [US3] Make `results.html` read every show-specific value from `data`:
  - the title, the subtitle and the copy-text header;
  - the "90:00" and "90 minutes" text, from `settings.budgetSeconds`;
  - the "two per band" text, from `settings.maxPerArtist`;
  - the `TARGET`, `GAP` and `MAX_PER_ARTIST` defaults, from settings.
  - Show each warning only when its id is in `settings.warnings`. The ids are: `waiting`, `vocalBalance` (for V2/duet, V1 rest and longest V1 run), `flatStretch`, `leadRun`, `dedication` and `cuts`.
  - Replace the anniversary wording in the dedication warning with generic text plus `show.occasion`.
- [X] T046 [US3] Switch `results.html` to the shared engine: replace its inline `orderSet` and `META` with the `setlist.js` engine (T025). Use `data.set.order` as the automatic order, so the page and the API always agree (FR-018). Keep the `META` fallback only for `oct` rows with no Energy value, until Phase 14 (T088).
- [X] T047 [US3] Switch the owner key in `results.html` to the owner code.
  - Replace the `prompt()` for the admin key with a small inline owner-code field.
  - Keep the code in memory only, and send it as `ownerCode`.
  - Use it for force, lock and unlock, maxSongs, save order and clear order.
- [X] T048 [US3] Port the Band Vote setlist UX into `results.html`:
  - A "Songs in the set" −/+ stepper that writes `maxSongs` through `/api/admin`. It is shown to everyone; the owner code is asked for when it is clicked.
  - An In/Out control on each setlist row and on each Ranking row.
  - Expandable set rows with:
    - the part links (tab, bass, keys, lyrics)
    - your learning status buttons
    - the band's name chips
    - an inline vote editor
  - A "Where the band is" readiness panel for each member (know/learning/not-started bar, k/N, % band-ready). It sits beside the set on desktop and above it on a phone.
  - A "Votes in" line.
  - Keep Rock Show's extras:
    - the three-state manual order banner
    - the lock snapshot
    - the tuning-change summary
    - role chips
    - the KEYS chip
    - the "Who voted what" tab
    - the CSV and paste fallbacks
- [X] T049 [US3] Show cut reasons in the Full ranking of `results.html`, using `row.cut`: veto, CAP, no room, held out. Also show a "below the line" divider.

**Checkpoint**: The November set page has parity with Band Vote; October's set page gains features without losing any. Push.

---

## Phase 6: User Story 6 — Click track (Priority: P2)

**Goal**: The drummer gets Band Vote's click page for any show. Tempos are shared through the library.

**Independent Test**:
1. On a phone with the silent switch on, start the click for a song.
2. Tap in a new tempo and save it.
3. Reload: the saved tempo is used, and it is labelled "from the sheet".

- [X] T050 [P] [US6] Write `test/api.tempos.test.js`. Check:
  - Out-of-range BPM is rejected with 400.
  - Saving a tempo for `nov` without the code is rejected with 401.
  - After a save, `/api/data` reports `bpmSource:"set"`.
  - A blank BPM falls back to `Library.Bpm` with source `"est"`.
- [X] T051 [US6] Create `click.html`, ported from BV:`click.html` onto `store.js` and `data.rows`. Keep everything:
  - the set and every-song lists
  - the full-screen lamp
  - audio-clock scheduling
  - the iOS playback session and silent unlock
  - tap tempo
  - the beats-per-bar cycle
  - mute, previous/next, and the key bindings
  - "Save to sheet" only when the value differs
  - the wall-clock fallback when audio is blocked
  - wake lock, and stopping when the tab is hidden
  Get the header branding from `data.show`.
- [X] T052 [US6] Add a "Click" link to the nav of all pages, keeping the `?show` param.

---

## Phase 7: User Story 4 — Track who knows what (Priority: P2)

**Goal**: The learn page works for any show. Readiness shows on both the learn page and the set page.

**Independent Test**:
1. As a November player, mark 5 songs on `/learn.html?show=nov`.
2. The chart, the chips on each song and the set-only counter update.
3. The readiness panel on the set page matches.

- [X] T053 [P] [US4] Add these tests to `test/api.shows.test.js`:
  - `nov` learn accepts only `nov·Settings.band` names.
  - The code is required.
  - Only the saving player's row changes.
- [X] T054 [US4] Make `learn.html` show-aware.
  - Read `?show` through `store.js`.
  - Use `data.show.name` for the title and `data.band` for the name buttons, and drop the hardcoded fallback BAND list.
  - Send the band code when it is required.
  - Keep every existing feature: the chart, the stage grouping, the unique initials, the filters, the keyboard badge and the set-only counter.
- [X] T055 [US4] Make sure `learn.html` and the readiness panel in `results.html` (T048) use the same counting function. Add a shared `readiness(rows, band)` to `setlist.js`, with a test in `test/engine.test.js`.

---

## Phase 8: User Story 7 — Song library carried across shows (Priority: P2)

**Goal**: Song details come with a song when it is added to a new show. Renaming a song keeps everything recorded against it.

**Independent Test**:
1. Add a song that already has lyrics, a tuning and a tempo to a scratch show's ballot.
2. All three appear.
3. No votes or learning come with it.

- [ ] T056 [P] [US7] Write `test/api.library.test.js`. Check:
  - Adding a song to a show copies Length, Year, Era, Energy, Tags, Lead and Keyboard from `Library` when the show's row leaves them blank.
  - An explicit `-` in Tags stays empty.
  - A rename through admin `update` keeps the key, so votes, learning, lyrics and tempo are all preserved.
  - Every show admin save upserts that show's song details into `Library`.
- [ ] T057 [US7] In `api/admin.js` `add[]`:
  - When a field is missing, fill it from `readLibrary()` for that key.
  - After any add or update, call `upsertLibrary` with the song's details, so every show keeps the library up to date.
- [ ] T058 [US7] In `api/_payload.js`, when a show row leaves a song-detail field blank and the row isn't curated, fall back to `Library`. Follow the curated rule in data-model.md "Show Songs"; this is the override path Phase 3 removes.

---

## Phase 9: User Story 8 — Song admin (Priority: P2)

**Goal**: The owner manages songs, keyboard judgement, sections and show settings for any show, from `admin.html`.

**Independent Test**:
1. With the owner code, bulk-paste 3 songs (one of them a duplicate) into `nov`.
2. The two new songs are added and the duplicate is rejected with a message.
3. Edit a keyboard value.
4. Without the code, every write gets 403.

- [ ] T059 [US8] Update the `admin.html` gate.
  - Replace "ADMIN_KEY in apps-script.gs" with "owner code".
  - Validate the code with an empty `/api/admin {show, ownerCode}` call.
  - Keep the code in memory only.
  - Read `?show` through `store.js`.
- [ ] T060 [US8] Add the admin song fields in `admin.html`:
  - Add a Keyboard select to the add form.
  - Add Year and Era to the table.
  - The Lead dropdown options come from `settings.leads`, and the Era options from `settings.eras`.
  - The bulk-paste format stays `Song | Artist | Lead | Length | Energy | Section | tags | tuning`.
  - Update the help text to match.
- [ ] T061 [US8] In `admin.html`, warn before removing a song that has votes: "N people have voted on this — remove anyway?". Use an inline confirm row, not `confirm()`.
- [ ] T062 [US8] Add a "Show settings" panel to `admin.html` that edits the show's settings from data-model.md "Show Settings":
  - name, occasion, band name
  - gig date
  - voters and band (tag inputs; the band must be a subset of the voters)
  - owner
  - budget minutes, gap seconds, max songs, max per artist
  - warnings (checkboxes)
  - leads, eras
  It saves through `/api/admin {settings}`. Extend `api/admin.js` to validate and write the keys with `writeSettings`, and to keep `gigDate` in sync with `Shows.GigDate`.
- [ ] T063 [P] [US8] Add these tests to `test/api.auth.test.js`:
  - An admin `settings` write with an invalid `band` (not a subset of voters) gets 400.
  - A valid write shows up in the next `/api/data`.

---

## Phase 10: User Story 1 — Set up a new show without touching code (Priority: P1, completes the reuse goal)

**Goal**: The owner creates, switches and archives shows from the app. No page carries hardcoded show text.

**Independent Test**:
1. Create "Test Show" by copying `nov`, with 3 voters, 2 players, a 45-minute budget and a cap of 1.
2. Load every page with `?show=test`.
3. The new names and limits appear everywhere, and no October or Bun's & Roses text does.

- [ ] T064 [P] [US1] Write `test/api.createShow.test.js`. Check:
  - `POST /api/shows {ownerCode, create:{id:"test", name, gigDate, copyFrom:"nov"}}` creates the `test·Songs` and `test·Settings` tabs, copying the songs but no votes, learning or availability.
  - A duplicate id gets 409.
  - A bad id gets 400.
  - `update {status:"past"}` makes writes to that show get 409.
- [ ] T065 [US1] Create `api/shows.js`.
  - GET returns `{shows, defaultId}`.
  - POST checks requireOwner, then handles either `create` or `update`, following contracts/api.md. `create` calls `ensureTabs(newShow)` and copies Songs (show fields and song details) and Settings from `copyFrom`.
- [ ] T066 [US1] Add a show switcher to `store.js` and to the header of every page: `index.html`, `results.html`, `learn.html`, `availability.html`, `admin.html`, `lyrics.html` and `click.html`.
  - It is a `<select>` of `/api/shows`, and changing it sets `?show=`.
  - Past shows are labelled "(past, read-only)".
  - When the show is past, pages hide all save and vote controls and show a banner.
- [ ] T067 [US1] Add a "New show" form to `admin.html` (id, name, gig date, and "copy songs and settings from"). It posts to `/api/shows`, then opens the Show settings panel for the new show.
- [ ] T068 [US1] Remove the remaining hardcoded show text: grep the whole repo for `October`, `Anniversary`, `Bun's`, `BUN'S`, `anniversary`, `Creed`, `Nickelback`, `Rich` (in user-facing strings), `90:00` and `two per band`. Replace each user-facing string with a value from `data.show` or `data.settings`. Leave code comments where the history is useful. Record the grep output in the commit message.
- [ ] T069 [US1] Reduce `config.js` to `window.SETLIST_API = "/api"`. Take out `SETLIST_VOTERS` and `SETLIST_BAND`, and point the offline fallbacks in the pages at the last `data` payload cached in `localStorage` (`rs_last_<show>`), wrapped in try/catch.
- [ ] T070 [P] [US1] Write `test/no-hardcoding.test.js`. It reads every `*.html` file and fails if a user-facing text node contains `October`, `Anniversary` or `Bun's`, apart from an allowlist of comment lines.

---

## Phase 11: User Story 9 — Rehearsal availability (Priority: P3)

**Goal**: Every show has its own availability calendar, running up to that show's gig date.

**Independent Test**:
1. On `/availability.html?show=nov`, mark days as a November player.
2. The range ends at November's gig date.
3. October's calendar is unaffected.

- [X] T071 [US9] Make `availability.html` show-aware.
  - Use `store.js` to get `?show`.
  - Get the title from `data.show.name` and the range end from `data.show.gigDate`.
  - Players come from `data.band`; drop the hardcoded fallback BAND.
  - Send the band code when it is required.
  - Keep the colours, the best-days card and the tooltips.
- [X] T072 [P] [US9] Add these tests to `test/api.shows.test.js`:
  - Availability saves for `nov` go to `nov·Availability` only.
  - Invalid day keys are skipped.

---

## Phase 12: User Story 10 — Owner diagnostics, pooling and offline dev (Priority: P3)

**Goal**: The owner gets Band Vote's pooling, CSV import and export, and storage check. Developers get an offline server.

**Independent Test**:
1. Run `pnpm dev`, and all pages work for `oct` and `nov` with fake data.
2. On the Admin tab, "Run check" reports health and the tabs for each show.
3. Importing a pasted BR2 code saves those votes.

- [X] T073 [US10] Write `dev-server.js`, adapted from BV:`dev-server.js`.
  - Serve the static files.
  - Mount the real `api/*.js` handlers on a `test/fakeSheets.js` client that has `setSheetsClient` applied. That means the dev server runs the real API code instead of a separate fake.
  - Seed it with `test/fixtures/oct-sheet.json`, plus a small `nov·` fixture made from `scripts/fixtures/bandvote-tracks-v32.json` and patterned votes.
  - Use port 8900.
  - Set the env to `BAND_SECRET=band` and `OWNER_SECRET=owner`, and print both on start.
- [ ] T074 [US10] Port the Admin tab tools from BV:`results.html` into `results.html`, under a new "Tools" tab:
  - **Copy my code / Copy all codes / Clear pooled**:
    - encode with BV `BR2-` codes;
    - the song keys are this show's `songKey`s;
    - still decode `BR1-`/`BR2-` codes, using `scripts/fixtures/bandvote-tracks-v32.json` for the positional keys, which gets copied to `/bandvote-tracks-v32.json` for the browser.
  - **Paste codes or CSV import**:
    - saves go through `/api/vote` with the owner code;
    - saving another person's row needs the owner code. Extend `api/vote.js`: when `body.voter` is not the requester (`body.me`), require requireOwner.
  - **Copy all votes (CSV)**.
  - **Storage check**: version, `/api/health`, rows per tab, and the show id. Add a "Copy report" button.
- [ ] T075 [US10] Extend `api/health.js`.
  - Report:
    - `BAND_SECRET` and `OWNER_SECRET`, as present or absent;
    - `Shows` rows;
    - the tabs found for each show's prefix;
    - the library tabs.
  - Keep the existing hints. Add a new one: "Share the sheet with the service account" when the error is 403.
- [ ] T076 [P] [US10] Write `test/api.pool.test.js`. Check:
  - Writing another voter's row without the owner code gets 403; with it, 200.
  - A BR2 code for the v32 positional keys decodes to the correct `songKey`s.

---

## Phase 13: Polish & Cross-Cutting Concerns

- [ ] T077 [P] Rewrite `README.md` for the multi-show app. Cover:
  - the pages
  - the Shows registry and the tab prefixes
  - the library tabs
  - the codes (`BAND_SECRET`, `OWNER_SECRET`, and the `APP_SECRET` fallback)
  - how to create a show
  - scoring
  - set control and warnings
  - migration notes
  - setup
  Fix the stale text: Order is column I, and the button names are the real ones.
- [ ] T078 [P] Update `api/_payload.js` and every page to show one `VERSION` constant from `setlist.js`, starting at `v33`. Add a `CHANGES` log in `setlist.js`, continuing Band Vote's log, and show it on the ballot gate.
- [ ] T079 [P] Accessibility and phone pass on every page at 375px:
  - no horizontal scroll;
  - tap targets of at least 40px;
  - colour is never the only signal (for example the `free/total` text on the calendar).
  Fix any problems in `app.css`.
- [ ] T080 Run quickstart.md §1, §2 and §4 end to end, and record the results in `specs/001-reusable-show-app/checklists/validation.md`.
- [ ] T081 Update `specs/001-reusable-show-app/spec.md` status to "Implemented (Phases 1–2)", and add a note linking `scripts/out/nov-migration-verify.txt`.

---

## Phase 14: Library normalisation and retirement (after the October gig on 24 Oct 2026, plan Phase 3)

**⚠️ Do not start before 25 Oct 2026, unless the owner says so.**

- [ ] T082 Capture fresh fixtures for every show: `/api/data?show=oct` and `/api/data?show=nov` into `test/fixtures/*-payload-pre-normalise.json`.
- [ ] T083 Write `scripts/normalise-library.js`, with the default dry run and `--apply`.
  - For each show's `Songs` tab, move Lead, Length, Energy, Tags, Keyboard, Year and Era into `Library`.
  - When two shows disagree on a value, report the conflict and use the most recent show's value.
  - Blank the show columns only after a backup (checked, as in T032).
- [ ] T084 Write `test/normalise.test.js` with fixtures. After normalising, each show's payload must be deep-equal to the pre-normalise fixture.
- [ ] T085 Run `pnpm backup`, then `normalise-library.js` as a dry run. **STOP for owner approval**, then run `--apply`. Re-run the parity against the T082 fixtures on the live data.
- [ ] T086 Remove the song-detail override path from `api/_payload.js` and `api/_sheets.js`. Show `Songs` now holds only `Key, Section, Order, Force`, and the song details come from `Library`.
- [ ] T087 [P] Remove the `TUNING_SEEDS` seeding from `setlist.js` and `api/_sheets.js` (`syncTunings`). Keep the `Tunings` rows already in the sheet.
- [ ] T088 [P] Remove the `META` map from `results.html` and the offline `LOCKED`, `PICKS` and `SONGS` arrays from `index.html`, now that all songs are curated in `Library`.
- [ ] T089 Set `RequireBandCode=TRUE` for `oct` (or mark it `past`, as the owner chooses), by editing the `Shows` row through `/api/shows`.
- [ ] T090 Tell the owner that the Band Vote deployment can be retired. Suggest adding a redirect page in BV that points to this app's `?show=nov` URL. Do not change the BV repo or sheet without explicit approval.
- [ ] T091 [P] Update `api/_sheets.js`: `ensureTabs` no longer adds the Year and Era columns to show `Songs` tabs. Delete the dead code.
- [ ] T092 Run the full `pnpm test` and quickstart §5. Update the README to match.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**:
  - Depends on Setup, and blocks every story.
  - T006 → T009 → T010 must finish before T011.
  - T008's backup must happen before T034.
  - T033 needs the owner's approval before T034 can run.
- **US5 Lyrics (Phase 3)**: depends on Foundational. This is the MVP.
- **US2 Vote (Phase 4)** and **US3 Set (Phase 5)**: depend on Foundational and on `store.js` (T036). US3's T048 reuses the learning buttons that US4 also relies on, but can use the existing `/api/learn`.
- **US6 Click (Phase 6)**: depends on T024, T025 and T036. It is independent of US2 and US3.
- **US4 Learn (Phase 7)**: depends on Foundational. T055 depends on T048.
- **US7 Library (Phase 8)**: depends on T021.
- **US8 Admin (Phase 9)**: depends on T018 and T019. T062 depends on T014.
- **US1 New show (Phase 10)**: depends on US8 (T062) and on every page being show-aware (US2–US6, US9).
- **US9 Availability (Phase 11)**: depends on Foundational only.
- **US10 Diagnostics (Phase 12)**: T073 depends on T004 and T029. T074 depends on T048.
- **Polish (Phase 13)**: runs after every story you plan to ship.
- **Phase 14**: gated by date (after 24 Oct) and by the owner's approval.

### Parallel opportunities

- Setup: T002 and T003 alongside T001. T005 alongside T004.
- Foundational:
  - T007 alongside T006.
  - Once T012 is done, T017, T020 and T031 (test files) can run in parallel.
  - T023 and T024 (separate endpoint files) in parallel.
  - T026 and T028 (file copies) in parallel.
  - T029 → T030 → T031 run in sequence, but alongside the T021–T028 track.
- After Foundational, the following can be handled by different people or agents at the same time: US5 (lyrics.html), US6 (click.html), US9 (availability.html) and US7 (api/admin.js + _payload.js). They touch different files.
- US2 (index.html) and US3 (results.html) can run in parallel. Each needs its own `store.js` change coordinated through T036 being done first.

### Parallel example: after Foundational

```text
Agent A: T035–T039  (lyrics.html, US5)
Agent B: T050–T052  (click.html, US6)
Agent C: T071–T072  (availability.html, US9)
Agent D: T056–T058  (library in api/admin.js, api/_payload.js, US7)
```

---

## Implementation Strategy

### MVP: November lyrics as soon as possible

1. Phase 1 Setup: T001–T005.
2. Phase 2 Foundational:
   1. Run the October safety net first: T006–T010.
   2. Then build shows, codes, library tabs and the engine: T011–T028.
   3. Then run the migration: T029–T034, which **needs the owner's approval** at T033.
3. Phase 3 US5 Lyrics: T035–T039, then push.
4. **STOP and CHECK**:
   - Band members can paste November lyrics.
   - October is unchanged (T009 and quickstart §4.3).
   - The owner sets the Vercel env codes.

### Incremental delivery after the MVP

- **November voting and set**: US2 and US3.
- **Rehearsal tools**: US6 (click) and US4 (learn).
- **Reuse**: US7 (library), US8 (admin), US1 (new show).
- **Remaining**: US9 (availability), US10 (diagnostics and tools), then polish.
- **After the October gig**: Phase 14.

### Stop points that need the owner

| Task | Why |
|---|---|
| T006 | Production URL for the fixture |
| T008 | First live write (backup only) |
| T033 | Approve the migration mapping; supply November's gig date and occasion |
| Checkpoint after Phase 3 | Set `BAND_SECRET` / `OWNER_SECRET` in Vercel |
| T085 | Approve library normalisation |
| T089 / T090 | October's code setting and Band Vote retirement |
