# Feature Specification: Reusable Show App (Band Vote parity + Rock Show extras)

**Feature Branch**: `main` (repo commits straight to main)

**Created**: 2026-09-24

**Status**: Clarified

**Input**: User description: "we are going to use "band vote/" as the guiding repo here. I want to basically update "rock show/" to have all the functionality of the original, but keep any functionality that was added and doesn't exist in "band vote/". Ultimately I want to create an app that I can reuse multiple times for new shows."

## Context

Two apps grew from the same idea and have drifted apart:

- **Band Vote** (the guiding app, v32): a one-song-at-a-time ballot, a setlist and standings page, a lyric book with chords, chord diagrams, autoscroll and print, a click-track page, an access code for all writes, owner-only set control, a song-count set size, in/out overrides, a band readiness panel, vote pooling and CSV import, a storage diagnostics check, an offline dev mode and an automated test suite.
- **Rock Show**: a songs list kept as editable data rather than code, an admin page, a separate learn page with a progress chart, a rehearsal availability calendar, separate voter and player lists, organiser-locked songs and "pick one" groups, a set lock snapshot, a keyboard judgement, a time-based set budget, vocal-balance and pacing warnings, a tuning-change summary, and stable song keys that survive renames.

Both apps have one band, one show and one set of names hardcoded throughout: band name, member names, show title, 90-minute budget, artist cap, seeded songs, tunings and energy maps. This feature merges them into one app that has all of Band Vote's features plus Rock Show's additions, and that can be set up for a new show without editing code.

## Clarifications

### Session 2026-09-27

- Q: How is the app reused across shows? → A: One app, many shows, in this repo, Vercel project and sheet. October and November run side by side.
- Q: How is the owner protected? → A: A shared band code for all writes, plus a separate owner code for owner actions.
- Q: Band Vote data? → A: Band Vote is the November show. Move everything (votes, set, learning, lyrics, tempos, tunings) with no loss.
- Q: Priority? → A: November with Band Vote's features, lyrics first, as soon as possible. October data must not be lost.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set up a new show without touching code (Priority: P1)

The owner starts a new show. They give it a name, a gig date, a band name, the voters, the players (a subset of the voters), the owner, a set budget (a song count or a running time), an artist cap and a vote cut-off. They also pick which songs are on the ballot. Once that is done they share a link and a code with the band.

**Why this priority**: This is the reason for the whole feature. Without it, every other feature stays tied to one show.

**Independent Test**: Create a show called "Test Show" with three voters, two players, a 45-minute budget and a cap of one song per artist. Load every page and confirm that the new names, title and limits appear everywhere and that nothing from the October show does.

**Acceptance Scenarios**:

1. **Given** a finished show, **When** the owner creates a new show with a different band, voters and budget, **Then** every page shows the new show's name, people and limits, with no leftover names, titles, song lists or warnings from the previous show.
2. **Given** a new show, **When** the owner builds its ballot, **Then** they can pick songs from the song library (see Story 7) and add new songs, without editing code or redeploying.
3. **Given** a show's settings, **When** the owner changes the band line-up (for example, swapping one player for another), **Then** the old member's data is kept but stops counting, and the new member starts with a blank ballot.
4. **Given** several shows, **When** a band member opens the app, **Then** they land on the current show and can still look at past shows read-only.

---

### User Story 2 - Vote on the setlist (Priority: P1)

A voter picks their name, enters the band access code once, and scores each song as Must play, Yes, Maybe or Pass. They see one song at a time (the Band Vote flow), or a full list/track overview, and can jump to any song. Organiser-locked songs are shown as fixed. For a "pick one" group they choose a single song. Each vote saves straight away.

**Why this priority**: Voting is the core loop for every show.

**Independent Test**: As a voter, score ten songs one at a time, reload the page, and confirm that it picks up where the voter left off and that the sheet holds their votes.

**Acceptance Scenarios**:

1. **Given** a voter with the code, **When** they vote on a song, **Then** the vote saves and the next song is shown, with progress ("x / N scored", "N left") updated.
2. **Given** a "pick one" group, **When** the voter picks one song, **Then** only that song is marked, and picking it again clears the choice.
3. **Given** a locked organiser song, **When** a voter tries to vote on it, **Then** they can't, and it shows as already in the set.
4. **Given** a name that is not on the show's voter list, **When** a vote is sent, **Then** it is refused.
5. **Given** the saving service is down, **When** a voter votes, **Then** the app says clearly that saving is off and offers the copy-my-votes code or text as a backup.
6. **Given** a voter on a phone or on a desktop, **When** they vote, **Then** the layout works at both sizes (the desktop shows the track list beside the card).

---

### User Story 3 - Build, control and share the set (Priority: P1)

Everyone can see the generated set, the full ranking and who voted what. The owner can:

- set the budget (a song count, or a running time when no count is set);
- force songs in or out;
- lock the set and unlock it;
- drag songs into a new running order, or go back to the automatic order;
- copy the set as text.

The app flags pacing and balance risks but never overrides the vote.

**Why this priority**: The set is what the band actually plays, and everything after the vote (learning, lyrics, click track) is driven by it.

**Independent Test**: With seeded votes, set the song count to 12, force one vetoed song in and one high scorer out, lock the set, change a vote, and confirm that the set does not move except for the forced changes.

**Acceptance Scenarios**:

1. **Given** votes are in, **When** anyone opens the set page, **Then** they see the set chosen by score. That set respects the artist cap and the veto (a negative total is never included), and it stops at the song count or, if no count is set, at the running time.
2. **Given** the owner, **When** they force a song In, Out, lock the set or reorder it, **Then** everyone sees the same result. The precedence is: force Out > force In > locked snapshot > vote.
3. **Given** a manual order, **When** songs later drop out or join, **Then** the saved positions of the remaining songs are kept, and new songs are added at the end.
4. **Given** a non-owner, **When** they try any set control, **Then** the server refuses it, not just the page.
5. **Given** any song with an unreadable length and no song count set, **When** the set is built, **Then** the build is refused with a message naming the bad songs.
6. **Given** a set, **When** it has risks (no slow song, a long run for one lead singer, too few songs for a second vocalist, a flat-energy stretch, no dedication moment), **Then** warnings show and the set is unchanged. Which warnings apply is configured per show.
7. **Given** a set, **When** it is displayed, **Then** it shows the tuning changes, the search links for each song (tab, bass, keys, lyrics) and the song roles (opener, closer, peak, breather, dedication, keys essential).

---

### User Story 4 - Track who knows what (Priority: P2)

Each player marks every set song Not started, In progress or Know it. The learn page shows:

- a chart per player;
- per song, who is at each stage, named with unique initials;
- filters for "In the set", "In the set, mine not done" and "Every song on the ballot".

The set page also carries a "Where the band is" readiness panel.

**Why this priority**: This is the main use after the vote and before the gig.

**Independent Test**: As a player, mark five songs, then confirm that the chart, the chips for each song, the readiness panel and the set-only counter all update.

**Acceptance Scenarios**:

1. **Given** a player, **When** they save their statuses, **Then** only that player's statuses change.
2. **Given** a voter who is not a player, **When** they open the learn page, **Then** they cannot mark anything.
3. **Given** the "every song" filter, **When** a player marks a song that is not in the set, **Then** the set readiness counters do not change.

---

### User Story 5 - Lyric book and chord help (Priority: P2)

Anyone with the code can paste lyrics (with or without chords) for each set song. The lyric book shows the songs in set order and offers:

- chord diagrams worked out in each song's own tuning;
- autoscroll over the song's running time;
- printing, one song per page;
- a copy-as-text option.

**Why this priority**: A Band Vote feature that the band uses during rehearsal and at the gig.

**Independent Test**: Paste lyrics with chords into one set song, tap a chord to see its diagram in that song's tuning, run autoscroll, and print.

**Acceptance Scenarios**:

1. **Given** a set song with no words, **When** a member pastes and saves lyrics, **Then** the lyrics are stored and appear in the book for everyone.
2. **Given** a chorded verse on a phone, **When** it is displayed, **Then** each chord stays above its syllable as the line wraps.
3. **Given** a song in Drop D, **When** a chord is tapped, **Then** the diagram is worked out for Drop D.

---

### User Story 6 - Click track (Priority: P2)

The drummer opens the click page, picks a set song and gets a flashing lamp and an audible click at the song's saved tempo and beats per bar. They can tap in a tempo, nudge it up or down, and save it for everyone.

**Why this priority**: A Band Vote feature used in rehearsal.

**Independent Test**: Start the click on a song on a phone with the silent switch on, tap in a new tempo, save, reload, and confirm the saved tempo is used.

**Acceptance Scenarios**:

1. **Given** a song with no saved tempo, **When** it is opened, **Then** the click uses the song's library tempo and labels it as an estimate.
2. **Given** audio is blocked by the browser, **When** the click is started, **Then** the lamp still flashes and a message explains why there is no sound.

---

### User Story 7 - Song library carried across shows (Priority: P2)

Every song has details that don't change from show to show: length, energy, tags, lead singer, tuning, tempo, keyboard judgement, lyrics and chords. These live in a song library that every show draws from, so a song used again in a new show brings them with it. Votes, set membership, forcing, order and learning status belong to each show separately.

**Why this priority**: This is what makes reuse cheap. Without it, every new show means re-typing tunings, tempos and lyrics.

**Independent Test**: Put a song with saved lyrics, tuning and tempo on the ballot of a new show, and confirm that all three appear with no re-entry and that none of the old show's votes or learning status come with it.

**Acceptance Scenarios**:

1. **Given** a library song used in an earlier show, **When** it is added to a new show, **Then** its lyrics, tuning, tempo, energy and tags come with it, and its votes and learning status start blank.
2. **Given** the owner renames a song, **When** they save, **Then** every vote, learning mark, lyric and tempo already recorded against it is kept.
3. **Given** a blank tuning or blank tags that someone typed on purpose, **When** the song is read, **Then** the blank is kept as the answer and no built-in default replaces it.

---

### User Story 8 - Song admin (Priority: P2)

The owner adds songs one at a time or pastes several at once, edits song details in a table (including keyboard judgement and tuning), removes songs, and sets up organiser-locked songs and "pick one" groups for the current show.

**Acceptance Scenarios**:

1. **Given** the owner, **When** they paste lines of the form `Song | Artist | Lead | Length | Energy | Section | tags | tuning`, **Then** the new songs are added and duplicates are rejected with a message.
2. **Given** someone other than the owner, **When** they try to change the song list, **Then** the server refuses.
3. **Given** a song that already has votes, **When** the owner tries to remove it from the show, **Then** they are warned before any votes are lost.

---

### User Story 9 - Rehearsal availability (Priority: P3)

Each player taps the days from today to the gig date that they can or can't make. The calendar colours each day by how many players have said no. A "best days" card lists the days nobody has ruled out.

**Acceptance Scenarios**:

1. **Given** the show's gig date, **When** the calendar opens, **Then** it runs from today to the gig date, and the gig day is marked.
2. **Given** a day nobody has answered, **When** it is displayed, **Then** it is grey (waiting), not red (refused).

---

### User Story 10 - Owner diagnostics, pooling and offline dev (Priority: P3)

The owner can do four things:

- run a storage check that reports the version, the backend health, and what is in the sheet;
- import other people's votes as pasted codes or CSV;
- export all votes as CSV;
- develop offline with a fake backend that needs no credentials.

A test suite covers scoring, selection, ordering, parsing, chords, tempo and autoscroll.

**Acceptance Scenarios**:

1. **Given** a broken setup (for example, the sheet is not shared with the service account), **When** the health check runs, **Then** it names the fault and how to fix it.
2. **Given** a developer, **When** they run the offline dev mode, **Then** every page works against seeded fake data, and the live sheet is not touched.

---

### Edge Cases

- A member leaves mid-vote. Their votes stop counting, but nothing is deleted, and putting their name back restores the votes exactly.
- A name typed with different capitals or spacing is matched to the name on the list, never stored as a second person.
- Two people save at the same moment. Neither write is lost.
- There are more slow songs than the set can absorb. The app says a song should be dropped, not reordered.
- A length cell is turned into a time value by the sheet. It is read correctly, or else the set build is refused with the song named.
- The gig date is missing or in the past. The calendar falls back to 8 weeks, or says the date has passed.
- A "pick one" group has no picks yet. It defaults to its best-scoring song, and a warning says so.
- The same song appears in two shows. Library details are shared between them, and votes are kept separate.
- A past show must never change by accident when the current show is edited.
- Votes cast in an older app version (the older vote scale or old backup codes) still import correctly.

## Requirements *(mandatory)*

### Functional Requirements

**Show setup and reuse**

- **FR-001**: The system MUST support more than one show. Each show has its own name, subtitle or occasion, gig date, band name, voter list, player list (a subset of the voters), owner, set budget (a song count and/or a running time plus a gap between songs), artist cap, and which warnings are switched on.
- **FR-002**: All shows MUST live in one deployed app, using this repo, this Vercel project and this Google Sheet. More than one show can be active at once (October and November run side by side). A show switcher defaults to the next upcoming show. The owner MUST be able to create a new show, optionally by copying the settings and song list of an earlier show, without code changes or a redeploy.
- **FR-003**: No show-specific text (band name, show name, people, occasion wording such as the anniversary copy, song-specific notes, budget numbers, artist cap text) may be hardcoded in the pages. It MUST all come from the show's settings.
- **FR-004**: Past shows MUST stay viewable read-only: the final set, votes and lyric book.

**Song library**

- **FR-005**: Songs MUST live as editable data, not in code. Each song has a stable identity that survives renames.
- **FR-006**: Details that don't depend on the show MUST be shared by every show that uses the song: title, artist, length, year, era, energy, tags, lead singer, tuning, tempo and beats per bar, keyboard judgement, lyrics and chords.
- **FR-007**: Details that depend on the show MUST be kept per show: whether the song is on the ballot, its section, locked/"pick one" status, votes, force in/out, manual position, and learning status.
- **FR-008**: A blank value that someone entered on purpose MUST be kept as the answer and never replaced by a built-in default. An explicit "none" marker MUST be available wherever a default could apply.
- **FR-009**: The seed data for the existing October show and for the Band Vote catalog (songs, tunings, tempos, energy maps) MUST be moved into the library and removed from code.

**Voting (Band Vote parity + Rock Show extras)**

- **FR-010**: The system MUST offer both ballot views. One is the one-song-at-a-time view, with previous, skip, next-unscored, clear, progress and resume. The other is a whole-list or track-list view for jumping between songs.
- **FR-011**: The votes MUST be Must play (+6), Yes (+2), Maybe (+1) and Pass (−4), and blank counts 0. The weights MUST be defined in one place and shown to every page.
- **FR-012**: The system MUST support organiser-locked songs (in the set, not up for a vote) and "pick one" groups (the voter chooses one song from a group).
- **FR-013**: Only names on the show's voter list MUST be able to vote. Names MUST be stored under the list's spelling.
- **FR-014**: When saving fails, the system MUST keep a backup: a copy-my-votes code or text. It MUST accept older backup codes and CSV imports.

**Set building and control**

- **FR-015**: Selection MUST be by score first (ties broken by the number of Must plays, then by length). Ordering MUST be a separate pacing pass, driven by energy, tags and lead singer.
- **FR-016**: Selection MUST exclude negative totals, apply the artist cap (forced and locked songs count toward the cap but are never dropped), and stop at the song count, or at the running-time budget when no count is set.
- **FR-017**: The owner MUST be able to force songs in or out, lock and unlock the set, set the song count, drag or arrow-reorder the set, and go back to the automatic order. These changes MUST be refused by the server for anyone else. The precedence is: force Out > force In > locked snapshot > vote.
- **FR-018**: The set, running order and lock state MUST be worked out in one place, so the vote, set, learn, lyric and click pages always agree on which songs are in the set.
- **FR-019**: The set page MUST show three tabs: the set, the full ranking with the cut line and the reason each song below it missed out (veto, cap, no room), and who voted what. It MUST also show the tuning-change summary, the search links for each song, the role chips, and the risk warnings configured for the show.
- **FR-020**: The system MUST refuse to build a set when a length that the set needs can't be read, and name the songs responsible.

**Band tools**

- **FR-021**: Players MUST be able to mark their own learning status for any song. The learn page and the readiness panel on the set page show progress by player and by song, as described in User Story 4.
- **FR-022**: Any code holder MUST be able to add or edit lyrics. The lyric book provides chord rendering, chord diagrams for the song's tuning, autoscroll, print and copy, as described in User Story 5.
- **FR-023**: The click-track page MUST provide a visual lamp, an audible click (including on phones with the silent switch on), tap tempo, beats per bar, and saving the tempo for everyone.
- **FR-024**: Players MUST be able to mark rehearsal availability from today to the gig date, and see the colour-coded calendar and the best-days summary.

**Access and administration**

- **FR-025**: All writes MUST need the band's shared access code, entered once and remembered on the device. Owner actions MUST also need a separate owner code, checked by the server: changes to the set and the song list, show settings, and pooling other people's votes. Typing the owner's name alone MUST NOT grant owner rights.
- **FR-026**: The owner MUST have a song admin view: add one song, bulk paste, an editable table covering every library field including keyboard judgement, removal (with a warning when the song has votes), and the show's locked and pick-one sections.
- **FR-027**: The system MUST provide a health check that names each setup fault and its fix, an owner storage diagnostics report, a CSV export of all votes, and a readable grid of the votes that is written as a copy (not the stored record).
- **FR-028**: The system MUST run offline against a fake backend for development, and MUST have automated tests covering scoring, selection, ordering, parsing, chords, tempo and autoscroll, extended to cover show settings and the library/show split.

**Migration**

- **FR-029**: The existing October Rock Show data MUST be moved into the new structure as the first show, with no loss of votes, learning status, availability, tunings, settings, order or locks. The mapping MUST be shown to the owner before anything is written to the live sheet.
- **FR-030**: Band Vote (Bun's & Roses) MUST be moved in as the live November show, with nothing lost. That covers its voters, votes, added songs, set state (in/out, order, song limit), learning status, lyrics, tempos and tunings. Its built-in songs, which Band Vote identifies by list position, MUST be mapped to stable library keys. The mapping MUST be shown to the owner before anything is written.
- **FR-031**: Delivery MUST be phased, with November first. The first release MUST put the November show live in this app with the lyric book, click track and the rest of Band Vote's features, so lyrics can be entered straight away. It MUST NOT disturb October's live pages or data. The full multi-show generalisation and the remaining cleanup can follow.

### Key Entities

- **Show**: one gig. It has a name, occasion text, gig date, band name, owner, voters, players, budget (song count or running time, and the gap between songs), artist cap, the warnings switched on, and a status (current, past).
- **Person**: a name that is on a show's voter list and possibly its player list. The same person may appear in many shows.
- **Library Song**: details that stay the same across shows: stable key, title, artist, length, year, era, energy, tags, lead singer, tuning, tempo, beats per bar, keyboard judgement, lyrics.
- **Show Song**: a library song on a show's ballot. It has a section, locked/pick-one status, force in/out and a manual position.
- **Vote**: one person's score for one show song.
- **Learning Status**: one player's stage for one song within a show.
- **Availability**: one player's yes/no for one day before a show.
- **Set**: the list and order worked out for a show, plus its lock snapshot and song count.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner can set up a new show and share its link in under 15 minutes, with no code edits and no redeploy.
- **SC-002**: Every user-facing feature in the Band Vote inventory, and every Rock Show feature missing from Band Vote, has a matching acceptance check that passes. That is 100% coverage of both inventories.
- **SC-003**: None of the names from the October show or Bun's & Roses (band, members, show title, occasion text) appear anywhere when a different show is loaded.
- **SC-004**: Migrating the live October show loses nothing. Vote, learning and availability counts match exactly before and after.
- **SC-008**: Moving November in from Band Vote loses nothing. Vote counts per person, lyric count, tempo count and set contents match Band Vote exactly.
- **SC-009**: Once the first release is out, the owner can paste November lyrics in this app, and October's pages are unchanged.
- **SC-005**: A song reused in a second show needs no re-entry of its lyrics, tuning or tempo.
- **SC-006**: A voter can finish a 60-song ballot on a phone in under 10 minutes.
- **SC-007**: Owner-only actions attempted by anyone else are refused 100% of the time, as confirmed by tests.

## Assumptions

- Hosting stays as it is: static pages plus serverless functions, with a Google Sheet as the store and the sheet as the source of truth that the owner can edit by hand.
- One owner per show (Rich by default). One band access code and one owner code per deployment. These are shared secrets, not per-person logins, and the app says so.
- October (gig 24 Oct 2026) is live and in use. Its pages, links and data must keep working throughout. Any change to its sheet tabs is additive or reversible, and is done only after the mapping has been shown and a backup taken.
- Band Vote's live sheet (the November source) has the ID `14nIIefs1Jks8kaU2YzuSLbpuXPDQqzW-zt4asu5TYS0`. The ID in Band Vote's `KICKOFF-PROMPT.md` is out of date. The move only reads from this sheet and never writes to it. The service account must be able to read it.
- Band Vote's current sheet and deployment stay untouched until the November data has been verified in this app. Band Vote is then retired.
- When the two apps behave differently, Band Vote's behaviour wins unless Rock Show's is a strict superset. Values that genuinely differ between shows (artist cap 1 vs 2, a song count vs 90 minutes, vocal-balance warnings) become per-show settings rather than a choice between the two apps.
- Rock Show's vocal-balance warnings (V1/V2/duet) become optional per-show warnings, because not every band has two lead vocalists.
- Search links (Ultimate Guitar, Songsterr, MuseScore, Genius) stay as links. No copyrighted content is fetched. Lyrics are only ever pasted by the band.
- Band Vote's dark "stage" styling, navigation and version badge become the shared look. Show and band names are filled in from settings.
- Pages must work on a phone and on a desktop.
- The package manager is pnpm.
