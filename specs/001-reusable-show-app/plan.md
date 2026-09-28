# Implementation Plan: Reusable Show App

**Branch**: `main` (this repo commits straight to main) | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-reusable-show-app/spec.md`

## Summary

Turn Rock Show into a single app that can run many shows. Every Band Vote feature comes across, and every Rock Show addition stays.

- **Backend.** Keep Rock Show's backend: stable song keys, the set worked out on the server, admin, learn and availability.
- **Band Vote modules to port:**
  - the pages: lyric book (`lyrics.html`) and click track (`click.html`)
  - the chords module (`chords.js`)
  - the one-at-a-time ballot
  - the engine: ordering, lyrics, tempo and autoscroll
  - the dev server and the tests
- **Storage.** Shows share one sheet. A `Shows` registry holds each show's tab prefix; October keeps its current, unprefixed tabs. Lyrics, tempos, tunings and song details live in shared library tabs.
- **Codes.** A band code is needed for any save, and a separate owner code for owner actions.

The work is done in three phases, with November first:

- **Phase 1:** November goes live with the lyrics and click pages, so lyrics can go in straight away. October's pages don't change.
- **Phase 2:** full parity and reuse.
- **Phase 3:** move shared song details into the library, after October's gig on 24 Oct.

## Technical Context

**Language/Version**: JavaScript (ES modules). Node ≥ 20 for the serverless functions, scripts and tests. Plain browser JavaScript for the pages, with no build step.

**Primary Dependencies**: `googleapis` (Sheets v4, service-account JWT). There are no front-end frameworks. The package manager is pnpm (`packageManager` pinned in package.json).

**Storage**: One Google Sheet (`SHEET_ID`). The tab layout is in [data-model.md](data-model.md). The Band Vote sheet `14nIIefs…TYS0` is a read-only source for the migration.

**Testing**: `node --test`. There are engine unit tests (about 100 ported from Band Vote, plus new ones), and API handler tests that run against an in-memory fake Sheets client through `setSheetsClient()`. An October payload-parity test compares against a captured fixture.

**Target Platform**: Vercel (static pages plus `api/*` functions). Phone and desktop browsers, including iOS Safari (for the click track's audio session).

**Project Type**: A static multi-page web app with serverless functions.

**Performance Goals**: Page data arrives in under 2 seconds on a phone over 4G. The click track's scheduling jitter is under 5 ms, using audio-clock scheduling as Band Vote does.

**Constraints**:
- There are no user accounts.
- The sheet stays hand-editable and is the source of truth.
- October is live until 24 Oct 2026. No destructive change may be made to its tabs, and its API responses must stay the same (fields may be added).
- Take a backup before any write to the live sheet.
- The Band Vote sheet is never written to.

**Scale/Scope**: Fewer than 10 people per show, about 2–5 shows a year, about 150 songs in the library, and lyrics of up to 20,000 characters per song.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the blank template, with no principles ratified, so there are no formal gates. These project rules apply instead, taken from the READMEs, the handoff notes and memory:

| Rule | Status |
|---|---|
| The sheet is the source of truth; adding songs, people or shows needs no deploy | ✅ Settings and Shows live in the sheet (R2, R9) |
| Read what the sheet displays, not its underlying values; an unreadable length is a hard failure | ✅ Kept in `_sheets.js` and `selectSet` |
| A blank typed on purpose is an answer; there is always an explicit "none" | ✅ data-model blank semantics |
| Selection and ordering stay separate; penalty weights are in one place and on one scale | ✅ R8 |
| Only the saving person's row is written; rows are upserted, never whole-range rewrites (except derived tabs) | ✅ contracts |
| Link to copyrighted material, never copy it; lyrics only come in by pasting | ✅ |
| pnpm only; commit straight to `main` | ✅ |

Re-checked after the design: no violations.

## Project Structure

### Documentation (this feature)

```text
specs/001-reusable-show-app/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/api.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
index.html          ballot: one song at a time + list view, pick-one, locked      (merge)
results.html        set / ranking / who-voted-what, owner controls, warnings     (merge)
lyrics.html         lyric book                                                    (port from Band Vote)
click.html          click track                                                   (port from Band Vote)
learn.html          who knows what                                                (keep, show-aware)
availability.html   rehearsal calendar                                            (keep, show-aware)
admin.html          songs, show settings, create show                             (keep, extend)
config.js           API path only (people lists removed in Phase 2)
setlist.js          shared engine: weights, keys, lengths, selection helpers, ordering,
                    lyrics/chord-line parsing, tempo, tap, autoscroll maths       (merge)
chords.js           chord shapes for any tuning                                   (port)
store.js            browser state: show selection, codes, fetch helpers           (port + adapt)
app.css             shared look (Band Vote stage theme)                           (port)
dev-server.js       offline fake API, seeded oct + nov                            (port + adapt)
api/
  _sheets.js        + show-prefixed tabs, Shows registry, library tabs
  _payload.js       + show/settings fields, bpm, hasLyrics, cut reasons
  _selection.js     settings-driven budget/cap
  _auth.js          band code / owner code / past-show guard                      (new)
  data.js vote.js learn.js availability.js admin.js health.js    (show-aware)
  lyrics.js tempos.js shows.js                                   (new)
scripts/
  backup-sheet.js   duplicate every tab to bak-YYYYMMDD·<Tab>
  migrate-bandvote.js   dry-run / --apply / --verify
  fixtures/bandvote-tracks-v32.json
test/
  engine.test.js    (ported setlist.test.js + ordering/tag additions)
  api.test.js       (fake Sheets client; codes, prefixes, per-person upsert)
  october.test.js   (payload parity vs fixtures/oct-payload.json)
  migrate.test.js   (key map + value transforms on fixtures)
```

**Structure Decision**: Keep the flat, no-build layout both apps already use, and add `scripts/` and `test/`. The pages stay as separate HTML files that share `setlist.js`, `store.js` and `app.css`.

## Delivery Phases

### Phase 1: November live, lyrics first (as soon as possible)

1. **Safety net**
   - Add `pnpm test` and the fake Sheets client.
   - Capture October's `/api/data` into a fixture and write the October parity test.
   - Add the `backup-sheet.js` script.
2. **Shows and prefixed tabs**
   - Add the `Shows` tab, seeded with `oct` (prefix `""`).
   - Every API endpoint takes a `show` value, defaulting to `oct`.
   - Add `_auth.js`, with `BAND_SECRET`, and `OWNER_SECRET` falling back to `APP_SECRET`.
   - Add `/api/shows`.
3. **Library tabs** `Lyrics` and `Tempos`, with `/api/lyrics` and `/api/tempos`. `Tunings` is already shared.
4. **Port Band Vote's front-end modules**
   - Bring over `chords.js`, `app.css` and `store.js` (show-aware).
   - Merge the lyric, tempo and autoscroll maths into `setlist.js`, and port the tests.
5. **Pages for November**
   - Port `lyrics.html` and `click.html` (show-aware; both also work for October).
   - Build a `?show=nov` path for `index.html` and `results.html`: the one-at-a-time ballot with a list toggle, set, ranking and owner controls, all on the shared API.
   - October's current page behaviour is kept when `show=oct`.
6. **Migration**
   - Take a backup.
   - Run `migrate-bandvote.js` as a dry run; **the owner reviews the mapping**; then `--apply`, then `--verify`.
7. **Go live**
   - Set `BAND_SECRET` and `OWNER_SECRET` in Vercel and redeploy.
   - Run the quickstart §4 smoke test, then share the November link.
   - Band Vote stays up (read-only in practice) until the owner confirms.

### Phase 2: full parity and reuse

- Merge the rest of each app into both shows:
  - For November: the learn page, availability, keyboard, admin, locked and pick-one songs, the lock snapshot, the tuning summary, and part links in both views.
  - From Band Vote: the pooling and CSV import, storage diagnostics, CSV export, and the readiness panel.
- Make the settings drive everything: voters and band from Settings, warnings switched per show, and no hardcoded names or show text left (SC-003).
- Add a show switcher, show creation (`copyFrom`), and read-only past shows.
- Turn on the band code for October once its gig is over (or earlier, if the owner decides).

### Phase 3: library normalisation (after 24 Oct)

- Move the song details (Length, Energy, Tags, Lead, Keyboard, Year, Era) out of every show's `Songs` tab into `Library`, with a backup first and a parity check against the payload captured before.
- Remove the override path, `META` and `TUNING_SEEDS` from code.
- Retire the Band Vote deployment.

## Risks

| Risk | Mitigation |
|---|---|
| Breaking October mid-show | Missing `show` defaults to `oct` with its unprefixed tabs; the payload parity test must pass before each push; changes to its tabs only add |
| Mis-mapping Band Vote's position keys | Frozen v32 catalog fixture; cross-check against the Title and Artist columns; the dry run aborts on any mismatch |
| Clashes between library rows (the same song's tuning in both sheets) | Existing rows win; clashes are reported in the dry run |
| The service account can't read the Band Vote sheet | The dry run checks access first and prints the fix |
| A key change in November's votes (vote values changing from numbers to words) | Tests on the migration transforms; `--verify` compares the set on both sides |

## Complexity Tracking

No constitution violations to justify.
