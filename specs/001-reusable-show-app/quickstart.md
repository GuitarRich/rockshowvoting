# Quickstart & Validation

These are checks that can be run to show the feature works. The rules they test are in [data-model.md](data-model.md) and [contracts/api.md](contracts/api.md).

## Prerequisites

- Node 20 or later, and pnpm.
- To work offline, you need nothing else.
- To run against the live sheet, you also need:
  - the `vercel` CLI, logged in;
  - `pnpm env` run once, which pulls the environment variables into a local file that git ignores;
  - the service account shared as an **Editor** on this app's sheet and as a **Viewer** on the Band Vote sheet `14nIIefs…TYS0`.

## 1. Offline (no credentials)

```sh
pnpm install
pnpm test          # engine + API handler tests against the fake Sheets client
pnpm dev           # http://localhost:8900, fake in-memory sheet seeded with oct + nov
```

Expected:
- Every test passes.
- `/?show=nov` shows the one-song-at-a-time ballot, headed "Bun's & Roses".
- `/` with no `?show` opens the show that is next by gig date, and the switcher lists both shows.
- `/lyrics.html?show=nov` shows the set in order. Pasting words and saving them persists after a reload.
- `/click.html?show=nov` makes the lamp flash, and a tapped tempo saves.
- `/?show=oct` matches today's October ballot: same songs, same labels, and no band code is asked for.

## 2. October regression (before any push in Phase 1)

```sh
pnpm test -- --test-name-pattern october
```

This compares the fields `/api/data?show=oct` returns against `test/fixtures/oct-payload.json`, a capture of today's live output. They must match exactly. New fields are allowed; changed or missing ones fail the test.

## 3. Backup, then move November in (live)

```sh
pnpm backup                                  # duplicates every tab → bak-YYYYMMDD·<Tab>, prints list
node scripts/migrate-bandvote.js             # dry run: mapping report, writes nothing
node scripts/migrate-bandvote.js --apply     # after owner reviews the report
node scripts/migrate-bandvote.js --verify    # re-reads both sheets, compares
```

The dry-run report must show:
- all 73 built-in songs mapped to slug keys, with nothing unmapped;
- the number of added songs;
- vote counts for each voter;
- the number of songs with lyrics and the number with tempos;
- tuning clashes with October's rows, if there are any;
- the set that results, matched against what Band Vote shows today.

`--verify` must report every count as equal (SC-008). The Band Vote sheet must be unchanged: its modified time and tab row counts are the same as before.

## 4. Live smoke test

1. Check `/api/health`: it should return `ok: true` and list the tabs for both `oct` and `nov`.
2. Open `/lyrics.html?show=nov`, enter the band code, paste lyrics for one song and save. Then confirm the row appears in the `Lyrics` tab.
3. Open `/?show=oct`, `/results.html?show=oct`, `/learn.html` and `/availability.html`. They should behave exactly as before (SC-009).
4. Send an owner action without the owner code. It must be refused with 403.

## 5. Phase 2/3 acceptance (later)

- Create a test show by copying `nov`. Load every page, and check that no October or Bun's & Roses names appear (SC-003).
- Mark the test show `past`, then try a vote. It must be refused with 409.
- After October's gig, run the Phase 3 library migration with `--dry-run` and then `--apply`. Afterwards, `/api/data?show=oct` should match the payload captured before the migration.
