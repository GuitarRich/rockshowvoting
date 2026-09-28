# Validation record — 2026-09-28

## quickstart §1: offline
- `pnpm test`: **130/130 pass**. Covers:
  - the engine ported from Band Vote, plus the tests added in the merge
  - API handlers: shows, codes, lyrics, tempos, the library, creating a show, pooling, health
  - migration mapping
  - October parity
  - the no-hardcoding check
- `pnpm dev`: every page was driven in headless Chromium against the fake sheet.
  - `vote.html`: the gate, a saved vote, and the list view.
  - `setlist.html`: owner unlock, force out, reorder, lock, and pooling BR1 and RS1 codes.
  - `lyrics.html`: saving asks for the band code, a wrong code is rejected and forgotten, and the chord popup draws.
  - `click.html`: a tempo saves and then shows as "set".
  - `learn.html`, `availability.html` and `admin.html`: settings save, bulk add, and the remove confirmation.
- At 375px wide, none of vote, setlist, click, admin or lyrics scrolls sideways.

## quickstart §2: October parity
- `test/october.test.js` passes against the payload captured from the live October app before any change.
- Live after every deploy: October still serves 53 songs, and its 20-song set is identical.

## quickstart §3: migration
- `pnpm backup` → 8 tabs copied to `bak-20260928·*`.
- Dry run → `scripts/out/nov-migration-report.md` (approved by the owner).
- `--apply` → `--verify`: all counts match, and the source sheet is unchanged. Details are in `scripts/out/nov-migration-verify.txt`:
  - votes: Rich 89, Pete 70, Joel 89, Anders 89
  - lyrics: 25 of 25 word for word
  - 102 tempos and 49 learning marks
  - the set is identical to Band Vote's 18

## quickstart §4: live
- `/api/health`: `ok: true`. It lists the tabs for both shows and the library tabs.
- It also shows a **warning**: BAND_SECRET is not set, so November saves are refused until the owner sets it in Vercel.
- `vote.html`, `setlist.html`, `lyrics.html`, `click.html`, `admin.html` and `codes.js` all return 200 on production.

## Not yet done
- Phase 14 (T082–T092) is gated until after the October gig on 24 Oct 2026.
- T069 (reducing `config.js`) is deferred to Phase 14. October's original pages still read their fallback lists from it.
