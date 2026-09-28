# Data Model: Reusable Show App

Storage is one Google Sheet: the existing Rock Show sheet (`SHEET_ID`).

Tabs are either **library** tabs (shared by every show, no prefix) or **show** tabs (named `<prefix><Tab>`). A show's prefix comes from the `Shows` tab. October's prefix is empty, so it keeps its current tab names.

## Shows (new; library)

This is the registry of shows. It is read on every request.

| Column | Type | Rules |
|---|---|---|
| Id | string | Required and unique. `[a-z0-9-]+`, e.g. `oct`, `nov` |
| Prefix | string | The tab-name prefix. `oct` → `""`; new shows get `<id>·` |
| Name | string | The display name, e.g. "October Anniversary Show" |
| GigDate | `YYYY-MM-DD` | Optional. Used for the default show, the availability range and ordering past shows |
| Status | `current` \| `past` | A `past` show is read-only: every POST for it returns 409 |
| RequireBandCode | `TRUE`/`FALSE` | `oct` → FALSE in Phase 1, `nov` → TRUE |

If the `Shows` tab is missing, it is created and seeded with the `oct` row, so an old deploy reading it keeps working.

**Default show**: the soonest `current` show with GigDate ≥ today. If there isn't one, the most recent `current` show. If still none, `oct`.

## Show Settings (`<prefix>Settings`, Key/Value)

The existing October keys stay: `maxSongs`, `locked`, `lockedKeys`, `gigDate`.

New keys (a missing key falls back to the default shown):

| Key | Default (= October today) | Notes |
|---|---|---|
| showName | the Shows.Name | Page title and header |
| occasion | "" | Subtitle text, e.g. the anniversary line |
| bandName | "" | Header and copy-text branding |
| voters | JSON of the current `VOTERS` | The authority on who can vote |
| band | JSON of the current `BAND` | Must be a subset of voters |
| owner | "Rich" | Shown in "Set by …" text only. Owner rights come from the owner code |
| budgetSeconds | 5400 | Used when maxSongs = 0 |
| gapSeconds | 25 | Gap between songs |
| maxPerArtist | 2 | 0 = no limit |
| warnings | `["waiting","vocalBalance","flatStretch","leadRun","dedication","cuts"]` | Which warnings the set page shows |
| leads | `["V1","V2","DUET"]` | Options for the lead dropdown in admin |
| eras | `[]` | Optional era labels, e.g. `["70s/80s","90s+"]` for November |

## Show Songs (`<prefix>Songs`)

This is October's existing layout, kept unchanged: Key, Section, Song, Artist, Lead, Length, Energy, Tags, Order, Force, Keyboard.

- Phase 1 adds the columns **Year** and **Era** to the right. This only adds columns.
- Phase 3 moves the song-fact columns (Lead, Length, Energy, Tags, Keyboard, Year, Era) into `Library`. A non-blank value left in a show row then overrides the library value.

Rules (the same as today):

- Key is stable. If Key is blank it falls back to `songKey(Song, Artist)`.
- Force is `IN`/`OUT`/blank.
- Order is a positive integer, or blank for automatic.
- A Section starting `LOCKED` puts the song straight in the set. A Section containing `pick ONE` makes a pick-one group, one per artist.

## Votes / Learning / Availability (`<prefix>Votes`, `<prefix>Learning`, `<prefix>Availability`)

The shapes are unchanged: one row per person, with the data as JSON.

- **Votes**: `{songKey: MUST|YES|MAYBE|NO|X}`
- **Learning**: `{songKey: NOT STARTED|IN PROGRESS|KNOW}`
- **Availability**: `{YYYY-MM-DD: YES|NO}`

Rows are matched by name without regard to case, and stored under the spelling in the show's list.

## Grid (`<prefix>Grid`)

Derived from the other tabs and rewritten on every save. Never read back.

## Library song content (library tabs, keyed by `songKey`)

| Tab | Columns | Blank semantics |
|---|---|---|
| `Lyrics` (new) | Key, Song, Artist, Lyrics | No row means no words. Maximum 20,000 characters |
| `Tempos` (new) | Key, Song, Artist, BPM, BeatsPerBar | A blank BPM falls back to `Library.Bpm`, then to "none" |
| `Tunings` (existing) | Key, Song, Artist, Tuning | Once a row exists it is authoritative, and a blank means E standard (as today) |
| `Library` (new) | Key, Song, Artist, Length, Year, Era, Bpm, Energy, Tags, Lead, Keyboard | Phase 1: a store to copy from when a song is added to a show. Phase 3: the only home of these fields |

## Set (computed, not stored)

`selectSet(showSongs, voters, settings)` returns `{rows (in set, in order), count, seconds, locked, blocked, badLengths, cut reasons}`.

- The order of precedence is: force OUT, then force IN, then the locked snapshot (`lockedKeys`), then the vote.
- The vote path is: forced songs, then LOCKED songs, then pick-one winners, then the rest by score. A negative total is skipped, and so is anything over the artist cap. Songs stop being added when the set reaches `maxSongs`, or `budgetSeconds` if `maxSongs` is 0.
- Ordering: the saved `Order` if there is one, otherwise the automatic engine (research R8).

## State transitions

- **Show**: `current` → `past`. The owner can do this, or the sheet can be edited by hand. `past` makes every write return 409.
- **Set**:
  - Unlocked follows the vote.
  - Lock snapshots the keys.
  - Unlock clears the snapshot.
  - Force IN and Force OUT apply in both states.
- **Manual order**: automatic → unsaved (on this device only) → saved to the sheet. "Back to automatic" clears Order.

## Migration mapping: Band Vote → `nov`

Source: sheet `14nIIefs1Jks8kaU2YzuSLbpuXPDQqzW-zt4asu5TYS0`. It is read-only.

**Key map**: `b<i>` becomes `songKey(TRACKS_v32[i].name, TRACKS_v32[i].artist)`. An added-song key stays as it is (already a slug). The script cross-checks every row that also carries Title and Artist columns, and aborts if the two disagree.

| Band Vote | → This app | Transform |
|---|---|---|
| catalog `TRACKS` (73) + `AddedSongs` | `nov·Songs` + `Library` | name→Song, seconds→Length (m:ss), year, era(set)→Era, bpm→Library.Bpm, energy, tags (the `slow` tag stays), lead. Section = "Ballot" |
| `Votes` VotesJSON | `nov·Votes` | 3→MUST, 2→YES, 1→MAYBE, 0→NO; keys remapped. Name, UpdatedAt and AppVersion are kept |
| `Setlist` State / Position | `nov·Songs`.Force / Order | in→IN, out→OUT |
| `Progress` (one column per member) | `nov·Learning` (one row per member, as JSON) | know-it→KNOW, in-progress→IN PROGRESS, not-started→NOT STARTED |
| `Settings` "Song limit" | `nov·Settings` maxSongs | Integer |
| `Lyrics` | `Lyrics` | Same slug keys; the text is copied unchanged |
| `Tempos` | `Tempos` | Same slug keys |
| `Tunings` | `Tunings` | Add only. On a key clash with an October row, the existing value is kept and the clash is reported |
| `Grid` | not copied | Rebuilt from the other tabs |
| — | `nov·Settings` | Sets showName "Bun's & Roses", bandName "Bun's & Roses", voters = the Votes row names ∪ BAND, band = `["Rich","Joel","Anders","Pete"]`, maxPerArtist 1, budgetSeconds 0 (count-driven), eras `["70s/80s","90s+"]`, warnings `["waiting","flatStretch","dedication","cuts"]` |
