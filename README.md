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
full. Nothing is promoted or demoted against the vote. Where the result looks
risky — no slow song, too little for the female vocalist, a long unbroken run
for one voice — the results page flags it in red but does not overrule you.

MAYBE does not count towards the running total on the ballot: the footer gauge
shows the set you'd actually play, so only MUST and YES add time.

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
| `dedication` | placed ~75% in, and **protected from being voted out** |
| `lift` | placed right after the ballad, to recover the energy |
| `dip` | placed around a third of the way in |

**Energy** is 1-5 and drives the shape of the set. Leave it at 3 if unsure.

Locked rows (organiser requests) are protected server-side — a voter cannot
overwrite them, though an admin can still edit or delete them here.

## After editing apps-script.gs

Deploy -> Manage deployments -> edit -> Version: **New version** -> Deploy.
Without that the live site keeps running the old code.
