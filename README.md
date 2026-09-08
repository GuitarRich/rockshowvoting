# Setlist Vote — October Anniversary Show

Static site for the band and organiser to vote on the setlist, backed by a
Google Sheet. No accounts, no logins for the band, nothing to run locally.

**The Google Sheet is the source of truth.** Every page reads its song list
from it, so adding or removing a song never needs a code change or a push.

Hosted on Vercel: the pages are static, and the serverless functions in `api/`
talk to the sheet with a Google service account. The band never sees Google —
they open a page and tap.

| File | What it is |
|---|---|
| `index.html` | The ballot. Pick your name, vote, save straight to the sheet. |
| `results.html`| Live tally, every person's votes, auto-generated running order. |
| `admin.html` | Add / edit / remove songs. Key-protected. |
| `learn.html` | Who knows what. Each player marks every song Not started / In progress / Know it. |
| `availability.html` | Who can make it. Each player taps the days they are free up to the gig. |
| `config.js` | The API path (`/api`), plus the voter and band names for the browser. |
| `setlist.js` | Shared constants: weights, `VOTERS`, `BAND`, vote and learn values, key/length helpers. |
| `api/` | The backend. One function per action, plus `_sheets.js` for all sheet access. |
| `apps-script.gs` | **Retired.** The previous backend, kept for reference only. |

### API

| Endpoint | Method | Body | Does |
|---|---|---|---|
| `/api/data` | GET | — | Everything: songs, votes, learn statuses, tunings, weights, limits. |
| `/api/vote` | POST | `{voter, votes}` | Saves one person's votes. |
| `/api/learn` | POST | `{person, learn}` | Saves one person's practice statuses. |
| `/api/availability` | POST | `{person, days}` | Saves one person's free days. |
| `/api/admin` | POST | `{key, add, update, remove, order}` | Song edits and the manual order. |
| `/api/health` | GET | — | Which env vars are set, whether the sheet opens. Check this first. |

Songs are addressed on the wire as `Song|Artist`, and resolved server-side to
the stable key in the sheet's `Key` column — so renaming a song in admin keeps
every vote and practice mark already recorded against it.

### Sheet tabs

| Tab | Holds |
|---|---|
| `Songs` | Key, Section, Song, Artist, Lead, Length, Energy, Tags, Order, Force, Keyboard. |
| `Votes` | One row per person: their whole ballot as JSON. |
| `Learning` | One row per person: their practice statuses as JSON. |
| `Tunings` | One row per song. Blank means E standard; a blank you typed is respected. |
| `Grid` | Derived, human-readable matrix. Rewritten on every save — never edit it. |
| `Availability` | One row per player: which days they can make, as JSON keyed `YYYY-MM-DD`. |
| `Settings` | Key/value: `maxSongs`, `locked`, `lockedKeys`, `gigDate`. Hand-editable. |

Missing tabs and headers are created on the first request, so there is no setup
script to run.

Practice status is deliberately kept apart from the vote — its own tab, its own
endpoint. Wanting a song in the set and being able to play it are different
questions. A song missing from someone's blob means "hasn't said", which is not
the same as `NOT STARTED`.

## Setup (once)

1. Create a Google Cloud service account, enable the **Google Sheets API**, and
   download its JSON key.
2. **Share the sheet with the service account's email address as an Editor.**
   Nothing works until you do; `/api/health` says so in as many words.
3. Set these environment variables in Vercel, for every environment:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` — the `...iam.gserviceaccount.com` address
   - `GOOGLE_PRIVATE_KEY` — the whole key including the BEGIN/END lines
   - `SHEET_ID` — the id out of the sheet's URL
   - `APP_SECRET` — the admin key for `admin.html`. Weak on purpose: it stops a
     bandmate deleting a row by accident. It is not authentication.
4. Push. Vercel builds on every commit to `main`.
5. Open `/api/health` and check `ok: true` before telling anyone the URL.

Env var changes do **not** apply to an existing build — redeploy after setting
them.

With `SETLIST_API` empty in `config.js`, the ballot falls back to manual
copy/paste and admin disables itself.

## Scoring

Votes are **MUST / YES / MAYBE / NO**, or blank for neutral. Weights live in
one place — the `WEIGHTS` object in `setlist.js` — and are served to every page
by `/api/data`, so changing a number there changes everything.

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
- **Max 2 songs per band** (`MAX_PER_ARTIST` in `setlist.js`, set 0 for no
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
therefore reads with `valueRenderOption` left at its default *formatted* value —
reading a time cell back as a date and reformatting it is timezone-dependent and
produces wildly wrong runtimes. If the results page refuses to build a set, the
fix is: select the Length column, **Format -> Number -> Plain text**, and retype
the offending values as `m:ss`.

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

Locked rows (organiser requests) are protected server-side — `/api/vote`
refuses to write to them, though an admin can still edit or delete them here.
`/api/learn` accepts them, because the locked songs are exactly the ones
everybody has to learn.

## Who votes, and who plays

Two lists in `setlist.js`, and they are not the same people:

- **`VOTERS`** — everyone with a ballot. Includes people who are coming to the
  show but not playing.
- **`BAND`** — the players. Only these appear on the learn page: being asked
  whether you know a song you will never play is just noise.

The lists are the only authority. Taking a name off `VOTERS` stops their votes
counting immediately and drops their column from the `Grid` tab, but **nothing
is deleted** — their row stays on the `Votes` tab, so putting the name back
restores their ballot exactly. `/api/vote` and `/api/learn` both refuse a name
that is not on the relevant list, and store under the list's spelling, so a
typo can never create a second row for the same person.

That is how a line-up change is done: swap the name. The person who left stops
shaping the set, and their replacement starts with a blank ballot rather than
inheriting opinions they never gave.

## Controlling the set

The set is worked out **by the API**, once, and served to every page — so the
results page, the learn page and the sheet can never disagree about which songs
the band actually has to play. Three controls sit above the generated setlist
on the results page. All of them ask for the admin key.

| Control | What it does |
|---|---|
| **Songs in the set** | A hard song count. Set 20 and the top 20 by score go in; the runtime it lands on is reported, not enforced. Leave it blank (0) and the 90 minutes decides the cut instead. |
| **Lock this set** | Snapshots exactly the songs in the set right now into `lockedKeys`. The list then stays put however people vote. |
| **Unlock** | Throws the snapshot away and hands the set back to the vote. |
| **IN / OUT** | Per song, on the Full ranking tab and as ✕ on each setlist row. Forces a song in or out whatever it scored. |

Precedence, highest first: **force OUT**, then **force IN**, then a **locked
snapshot**, then the vote. So a forced song still overrides a locked list —
you can correct a frozen set without unlocking it and losing it.

Locking is the answer to "the order keeps moving and nobody trusts it". Lock
once the vote has settled, and the band can learn a list that will not change
under them.

## Who can make it

`availability.html` is the rehearsal calendar, running from today to `gigDate`
in the Settings tab. Pick your name, then tap a day: **can make it** → **can't**
→ back to no answer. Nothing saves until you press the button.

A day is **green** when every player has said yes, **amber** when one has said
no, **red** when two or more have, and stays grey while it is only waiting on
answers — a day nobody has confirmed must not look like a day everybody has
refused. Every cell carries a `free/total` count, so the colour is never the
only thing saying what a day means. Hovering names who is in, who is out, and
who has not replied.

The card at the top ranks the best days: most people free first, soonest as the
tie-break, and a day anybody has ruled out never appears there however many
others are free.

Only `BAND` appears — the calendar exists to get the players in a room.

## Keyboard

Each song carries a **Keyboard** judgement, set on the admin page:
`ESSENTIAL` (the song does not work without it), `ADDS` (keys lift it, but it
stands up without them), or `NONE` (no part needed). Blank means nobody has
judged it yet — deliberately different from `NONE`, because a keys player needs
to tell "no part needed" from "no answer".

It shows as a badge on the learn page, and songs marked essential get a `KEYS`
chip on the generated running order.

## Who knows what

`learn.html` is the practice tracker. Pick your name, mark each song **Not
started / In progress / Know it**, save. Tap the same button again to clear it
back to "haven't said".

- It shows **the songs that made the set** — the ones people actually have to
  play — not the whole ballot. The page says whether that set is locked or can
  still move, so nobody learns twenty songs off a provisional list.
- Each song lists the band **by name**, grouped by stage — knows it, learning,
  not started, no reply — so "who do I chase about this song" is answered
  without hovering anything. Initials are the shortest that stay unique, so a
  Justin and a Julie never share a chip. A song everyone knows collapses to a
  single line saying so.
- A chart at the top gives the same picture the other way round: one stacked
  bar per player, with the number of songs the whole band knows leading.
- Filters: **In the set**, **In the set, mine not done**, and **Every song on
  the ballot** for marking things you already know that did not make it.
- The counter is always about the set, whichever list is on screen: marking
  songs that are not in it must not make anyone look ready.
- It covers every song in the set including the locked ones, and it never
  affects the vote or the generated setlist.
