# Research: Reusable Show App

Phase 0 output. Every open question from Technical Context is resolved here.

## R1. Which app is the base: the Band Vote code or the Rock Show code?

- **Decision**: Keep the **Rock Show backend**. That means the `api/` shape, stable song keys, server-side selection, the `{ok,error}` envelope and the key resolver. Port **Band Vote's front end and engine modules** onto it:
  - `lyrics.html`, `click.html`, `chords.js`
  - Band Vote's `setlist.js` code for lyric parsing, autoscroll, tempo, tap and beat scheduling
  - `store.js` patterns, `app.css`, `dev-server.js`, and `setlist.test.js`
- **Rationale**:
  - Rock Show already has what reuse needs: songs stored as data, stable keys that survive renames, and separate voter and player lists.
  - Band Vote's built-in catalog is stored in code, and its songs are keyed by list position (`b0..b72`). That is the opposite of reusable.
  - Band Vote's page modules are self-contained and well tested, so they port cleanly.
- **Alternatives considered**:
  - Rebase onto Band Vote and graft Rock Show's features in. Rejected: we would have to un-hardcode the catalog and re-add stable keys, admin, learn and availability, which is more work, and October's live backend would change underneath it.

## R2. How several shows share one Google Sheet

- **Decision**: Add a **`Shows` registry tab**. Each show has an `id`, and all of that show's own tabs start with `<id>·`, for example `nov·Votes`.
  - **October is the exception.** Its id is `oct` and its tab prefix is empty, so it keeps using the tabs it has today (`Songs`, `Votes`, `Learning`, `Availability`, `Settings`, `Grid`).
  - Song content that belongs to the song rather than to a show goes in **library tabs with no prefix**: `Library`, `Lyrics`, `Tempos`, and the existing `Tunings`.
- **Rationale**:
  - October's tabs are never renamed or moved, which gives zero risk to live data (FR-029, SC-004).
  - One sheet stays hand-editable, and it is still the source of truth.
  - Adding a show means adding tabs. No existing tab changes.
- **Alternatives considered**:
  - One sheet per show. Rejected by the user in clarification Q1, and it would break sharing of lyrics and tempos.
  - A `Show` column on every tab. Rejected: every read would need filtering, and hand-editing gets error-prone.

## R3. Where song content lives (the library vs the show)

- **Decision**: Build it in two stages.
  - **Phase 1 (November)**:
    - Lyrics, tempos and tunings are library-level straight away (`Lyrics`, `Tempos` and `Tunings` tabs, keyed by `songKey`).
    - A show's `Songs` tab still holds the song's details inline: length, energy, tags, lead, keyboard, year, era.
    - When the owner adds a song to a show, those details are copied from the `Library` row if one exists.
  - **Phase 3**:
    - The details move into the `Library` tab, and each show's `Songs` tab keeps only show fields (Key, Section, Order, Force).
    - The reader already treats an inline value in a show's tab as an override of the library value. Phase 3 is just the migration and then dropping the override path.
- **Rationale**:
  - SC-005 (lyrics, tuning and tempo reuse) is met in Phase 1 without restructuring October's `Songs` tab under a live show.
  - FR-006 sharing for energy and tags lands in Phase 3, once October's gig (24 Oct) is over.
- **Alternatives considered**:
  - Normalising everything in Phase 1. Rejected: it rewrites October's `Songs` tab during its live window.

## R4. Moving Band Vote in as the November show

- **Decision**: Write a one-off Node script, `scripts/migrate-bandvote.js`. It reads sheet `14nIIefs1Jks8kaU2YzuSLbpuXPDQqzW-zt4asu5TYS0` **read-only** and has two modes:
  - `--dry-run` (the default) prints a mapping report and writes nothing.
  - `--apply` writes the `nov·*` tabs and the library rows in this app's sheet.
- **Mappings** (the full field mapping is in `data-model.md`):
  - **Song keys**:
    - Built-ins `b0..b72` become `songKey(name, artist)`, using the **v32** `TRACKS` array. That array is vendored into the script as a frozen fixture, because positions are the only link.
    - Added songs already use the `songKey` slug, and Lyrics already uses the same slug function (the two implementations are byte-identical).
  - **Votes**: `3→MUST`, `2→YES`, `1→MAYBE`, `0→NO`, blank → absent.
  - **Progress**: `know-it→KNOW`, `in-progress→IN PROGRESS`, `not-started→NOT STARTED`.
  - **Setlist State**: `in→IN`, `out→OUT` in `nov·Songs.Force`. `Position` goes to `Order`.
  - **Settings**: `Song limit` goes to `nov·Settings.maxSongs`.
  - **Voters and band**: the voters are the names on Band Vote's `Votes` rows. The band is `Rich, Joel, Anders, Pete`.
- **Verification**: the script reads everything back and checks the per-person vote counts, the lyric count, the tempo count, and the set contents computed on both sides (SC-008).
- **Rationale**:
  - A script can be re-run, compared and reviewed, and a dry run satisfies the "show mapping first" rule.
  - The source sheet is never written to.
- **Alternatives considered**:
  - An in-app import button. Rejected: it is one-off work, and it would need owner UI in Phase 1 for no lasting value.
  - Copying tabs by hand. Rejected: too error-prone with 73 positional keys.

## R5. Codes: the band code and the owner code

- **Decision**: Use two env vars.
  - `BAND_SECRET` is the shared band code. It is required on every write for shows that have `requireBandCode = TRUE` in `Shows`.
  - `OWNER_SECRET` is the owner code. It is required on every owner action.
  - For backward compatibility, `OWNER_SECRET` falls back to the existing `APP_SECRET`, so October's admin key keeps working unchanged.
  - Whether October requires the band code is a flag in `Shows`. It starts **off**, so voting on October's pages behaves exactly as today. November starts **on**.
  - Clients store the band code in `localStorage` and keep the owner code in memory only (as Rock Show does).
- **Rationale**:
  - Matches clarification Q2, and October's pages are not disturbed (SC-009).
  - Typing the owner's name alone never grants owner rights.
- **Alternatives considered**:
  - One secret for everything. Rejected: the user chose separate codes.

## R6. How pages know which show they are on

- **Decision**:
  - A `?show=<id>` query parameter picks the show.
  - Without it, pages open the show marked `current` in `Shows` that has the soonest `gigDate` on or after today, and the page header has a show switcher.
  - The API takes `show` as a query parameter (GET) or a body field (POST). It defaults to `oct` if the parameter is missing, so October's existing pages and bookmarks keep working with no change.
- **Rationale**: Links can be shared per show, and October's URLs don't break.

## R7. Testing approach

- **Decision**:
  - Adopt Band Vote's `node --test` suite, porting its roughly 100 engine cases.
  - Add tests for tab-prefix resolution, the migration mappings (run against fixtures), code gating, and selection parity between Band Vote's rules and Rock Show's rules.
  - Use `_sheets.js`'s `setSheetsClient()` seam with an in-memory fake Sheets client, so API handlers can be tested with no credentials.
  - Port `dev-server.js`, adapted to serve Rock Show's API from the same fake client.
- **Rationale**:
  - Both READMEs say the bugs that bite only show up across a real read/write cycle.
  - The fake client covers that cycle without touching the live sheet.

## R8. Ordering engine: which one wins?

- **Decision**:
  - Use the **Band Vote engine** (`seedOrder`, `orderCost`, `repairOrder` in `setlist.js`) as the base, because it is tested.
  - Extend it with Rock Show's extra tags (`heavy`, `lift`, `dip`) and the adjacency rule "same artist next to each other".
  - Move it into the shared `setlist.js`, so the server and the pages run identical code. The penalty table stays in one place (gotcha 5).
- **Rationale**: One tested engine instead of two diverging copies. Rock Show's copy lives inline in `results.html` and has no tests.

## R9. Per-show configuration versus constants

- **Decision**:
  - Each show's `Settings` tab (`nov·Settings`, and October's existing `Settings`) gains these keys, all hand-editable:
    - `showName`, `occasion`, `bandName`
    - `voters` and `band` (JSON arrays)
    - `owner`
    - `budgetSeconds`, `gapSeconds`, `maxSongs`, `maxPerArtist`
    - `warnings` (JSON array, e.g. `["vocalBalance","dedication","flatStretch"]`)
    - `leads` (JSON array, for the admin dropdown)
  - `setlist.js` keeps the **defaults** only.
  - October's missing keys fall back to today's constants (90 minutes, cap 2, the current VOTERS and BAND), so its behaviour doesn't change until someone edits a value.
- **Rationale**: FR-001 and FR-003, with no behaviour change for October.

## R10. Deployment during Phase 1

- **Decision**:
  - Commit straight to `main`. That is the standing preference for this repo, and Vercel deploys from `main`.
  - Before any write to the live sheet, the migration and backup scripts take a **backup**: they duplicate every existing tab into `bak-2026MMDD·<Tab>`, which is hidden, and they log the list.
  - Phase 1 changes to the October code path must pass the October regression tests (payload parity checked against a captured fixture of today's `/api/data`) before they are pushed.
- **Rationale**: October is live and there is no staging environment. The backups and the parity tests are the safety net.

## R8a. Amendment made during implementation: two ordering engines

- **Decision**: Keep **both** engines in `setlist.js`, and choose one per show with the `orderEngine` setting:
  - `"pacing"` is Rock Show's `orderSet`, copied over verbatim along with its `META` fallback map. It is the default, so October's automatic order doesn't change.
  - `"curve"` is Band Vote's seed-and-repair engine. November uses it.
- **Rationale**:
  - Replacing October's engine would have moved its automatic running order while the show is live, which breaks the October-unchanged rule.
  - Both engines now live in one shared, tested module, and the server works the order out once (`set.order`). That keeps FR-018: every page agrees on the order.
- **Selection tie-break**: follows the same approach. A `tieBreak` setting chooses `"energy"` (October) or `"shorter"` (Band Vote's `a.dur - b.dur`), so November's set comes out identical to Band Vote's.

## R11. Amendment made during implementation: new ballot and setlist pages

- **Decision**: October's `index.html` and `results.html` stay exactly as they are until its gig. Any show other than October is sent to two new pages:
  - `vote.html`: Band Vote's one-song-at-a-time ballot, with a whole-list view, pick-one groups and locked songs.
  - `setlist.html`: Band Vote's set, ranking and readiness panel, plus Rock Show's forced, locked and pick-one songs, the lock snapshot, tuning changes, role chips, the per-show warnings and the who-voted-what table.
  - A link with no show named also goes to the new pages once the default show is no longer October.
- **Rationale**: This keeps the October-unchanged rule literally true while November gets full Band Vote parity.
- **After 24 Oct**: the new pages replace the old two, which retire in Phase 14.

## R12. Amendment (2026-09-29): October moved onto the new pages early

At the owner's request, October now uses `vote.html` and `setlist.html` like every other show.
- `index.html` and `results.html` are now redirects that keep `?show=`.
- October's data, set and automatic running order are unchanged. The server works out the order with October's own `pacing` engine and its `META` fallback.
- October's offline copy/paste and CSV fallbacks from the old results page are gone. Pooling and the CSV export on the setlist page's Tools tab replace them.
