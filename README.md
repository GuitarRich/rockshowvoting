# Setlist Vote — October Anniversary Show

Static site for the band and organiser to vote on the setlist, backed by a
Google Sheet. No accounts, no logins, no server to run.

**The Google Sheet is the source of truth.** Both pages read their song list
from it, so adding or removing a song never needs a code change or a push.

| File | What it is |
|---|---|
| `index.html` | The ballot. Pick your name, vote, save straight to the sheet. |
| `results.html`| Live tally, every person's votes, auto-generated running order. |
| `admin.html` | Add / edit / remove songs. Key-protected. |
| `config.js` | The one file you edit — the Apps Script URL and voter names. |
| `apps-script.gs` | The backend. Paste into the Sheet's Apps Script editor. |

Sheet columns: **A–F** song details, **G–M** the seven voters, **N** SCORE,
**O** MUSTs, **P** Energy, **Q** Tags, **R** Order (blank = automatic).

## Setup (once)

1. Open the vote Google Sheet -> **Extensions -> Apps Script**.
2. Delete the contents of `Code.gs`, paste in `apps-script.gs`.
3. **Change `ADMIN_KEY`** at the top to something only you know. Save.
4. Run the `setupSheet` function once and approve the permission prompt.
   It fixes the voter columns, adds Energy/Tags columns, widens the score
   formulas so new rows keep working, and colour-codes the vote cells.
5. **Deploy -> New deployment -> Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**  <- voters have no Google login
   Deploy, approve, copy the `/exec` URL.
6. Paste that URL into `window.SETLIST_API` in `config.js`.
7. Commit and push. GitHub Pages redeploys in about a minute.

With `SETLIST_API` empty, the ballot and results pages fall back to manual
copy/paste and admin is disabled.

## Scoring

Votes are **MUST / YES / MAYBE / NO**, or blank for neutral. Weights live in
one place — the `WEIGHTS` object in `apps-script.gs` — and are used to build
the sheet formula *and* served to both web pages, so changing a number there
changes everything.

| Vote | Weight |
|---|---|
| MUST | 6 |
| YES | 2 |
| MAYBE | 1 |
| NO | &minus;4 |
| blank | 0 |

The scale is deliberately double the original (MUST 3 / YES 1 / NO &minus;2) so that
votes cast before MAYBE existed keep their exact relative weight — adding
MAYBE re-ranked nothing.

**Selection is pure total score.** Locked organiser requests go in
automatically; everything else is taken highest-first until the 90 minutes is
full. Nothing is promoted or demoted against the vote. Two hard limits apply:

- Songs with a **negative** total are never included - the band voted them down -
  even if there is time spare.
- **Max 2 songs per band** (`MAX_PER_ARTIST` in `apps-script.gs`, set 0 for no
  limit). Locked requests count towards a band's allowance but are never
  dropped. Since the list is score-ordered, a band keeps its two best scorers
  and the rest are marked `CAP` on the ranking tab.

Where the result looks risky — no slow song, too little for the female
vocalist, a long unbroken run for one voice — the results page flags it in red
but does **not** overrule the vote.

MAYBE does not count towards the running total on the ballot: the footer gauge
shows the set you'd actually play, so only MUST and YES add time.

## A gotcha: the Length column

Google Sheets silently turns `3:23` into a **time value**, not text. The backend
therefore reads the sheet with **`getDisplayValues()`, never `getValues()`** -
reading a time cell back as a Date and reformatting it is timezone-dependent and
produces wildly wrong runtimes. If the results page refuses to build a set, the
fix is:

> run **`fixLengths`** from the Apps Script editor

That rewrites the whole Length column as plain text `m:ss` and sets the column
format to text, so Sheets can never reinterpret it again. (Manual equivalent:
select the Length column, Format -> Number -> Plain text, retype the values.)

`parseLen()` on both pages accepts `m:ss`, `h:mm:ss` and Sheets' rendered forms
(`3:23:00`, `3:23:00 AM`), treating anything longer than 15 minutes as a
misparse. It deliberately does **not** salvage a raw date string - guessing at
one produced badly wrong runtimes, and a wrong length silently breaks the
90-minute cap. Unreadable lengths block the build with a banner instead.

## Adding or removing songs

Open `admin.html`, enter the admin key, edit the table, hit **Save changes**.
Add one at a time or paste a batch as
`Song | Artist | Lead | Length | Energy | Section | tags`.

**Tags** steer the auto-generated running order:

| Tag | Effect |
|---|---|
| `opener` | pulled towards the first slot |
| `closer` | pulled towards the last slot |
| `heavy` | clustered in the 50-80% peak |
| `ballad` | placed after the peak |
| `dedication` | placed ~75% in; a warning fires if no ballad makes the set |
| `lift` | placed right after the ballad, to recover the energy |
| `dip` | placed around a third of the way in |

**Energy** is 1-5 and drives the shape of the set. Leave it at 3 if unsure.

**A row with an Energy value is treated as curated** — its Tags are used
exactly as written, including blank. So to remove a tag, just delete it.

Rows with **no** Energy value fall back to a built-in map of well-known songs,
which carries sensible energy and tags. For those rows only, put `-` in Tags to
force "no tags".

### Pacing rules in the running order

- No two **slow** songs sit next to each other, and preferably not one apart.
  "Slow" means energy <= 2 **or** a `ballad` / `dedication` / `dip` tag — energy
  alone isn't enough, because a power ballad often gets entered as energy 3.
- No four-song window is allowed to sag below an average energy of ~3.1. A
  trough is what empties a dancefloor, and it is usually built from mid-tempo
  songs that each look fine on their own.
- No three songs in a row share a lead vocalist; no two by the same band are
  adjacent.

If a flat stretch survives anyway, the page says so — that means there are more
slow songs than a 90-minute set can absorb, and the fix is dropping one, not
reordering.

The **Generated setlist** is a running order, not a ranking: songs are *chosen*
by score, then *ordered* for how the night should feel, so the top scorer is
usually not first. The **Full ranking** tab is the score order.

## Taking manual control of the running order

Above the generated setlist there is a banner with one of three states:

- **Automatic** — the order is recomputed from the votes every time the page
  loads, so it moves as people vote.
- **Unsaved order** — you have dragged something. Only you can see it.
- **Manual order, saved to the sheet** — everyone sees this exact list, and it
  no longer changes when votes do.

Drag a row by the grip on the left, or use the ▲ ▼ buttons. Then:

| Button | What it does |
|---|---|
| **Save this order** | Writes the positions to column **R (Order)** in the sheet. Asks for the admin key. |
| **Undo changes** | Throws away your unsaved drags. |
| **Back to automatic** | Clears column R so the order is computed from votes again. |

Selection is unaffected — the manual order re-arranges the songs the vote chose,
it does not add or drop any. If a song later drops out of the set on score, its
saved position is simply ignored and the rest close up; anything new that gets
voted in lands at the end. Clear the order and re-save if you want a fresh pass.

## Parts: tabs, bass, keys, lyrics

Every song on the generated setlist **and** in the full ranking carries four
links, built from the song and artist — nothing to maintain in the sheet, and
anything added later gets them for free.

| Link | Goes to | Why that one |
|---|---|---|
| **tab** | Ultimate Guitar, sorted by their own rating | top hit is the highest-rated tab, not the newest |
| **bass** | Songsterr | multi-track: solo the bass line, slow it down, loop a section — a plain text bass tab can't do any of that |
| **keys** | MuseScore | where the actual piano transcriptions are |
| **lyrics** | Genius | |

Each opens a search rather than one fixed page, so a bad title match is one
click from the right result instead of a dead link.

**keys will come up thin or empty for songs that have no keyboard part** —
that is the honest answer, not a bug. Nothing on Nirvana or Breaking Benjamin
needs a keys player.

They are links rather than stored copies on purpose: tabs and lyrics are
copyrighted, and a link always shows the current, correct version.

Locked rows (organiser requests) are protected server-side — a voter cannot
overwrite them, though an admin can still edit or delete them here.

## After editing apps-script.gs

Deploy -> Manage deployments -> edit -> Version: **New version** -> Deploy.
Without that the live site keeps running the old code.
