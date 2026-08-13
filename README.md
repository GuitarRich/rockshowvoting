# Setlist Vote — October Anniversary Show

Static site for the band and organiser to vote on the setlist, backed by a
Google Sheet. No accounts, no logins, no server to run.

| File | What it is |
|---|---|
| `index.html` | The ballot. Pick your name, vote, save straight to the sheet. |
| `results.html`| Live tally, every person's votes, and an auto-generated running order. |
| `config.js` | The one file you edit — the Apps Script URL and the voter names. |
| `apps-script.gs` | The backend. Paste into the Sheet's Apps Script editor. |

## Setup (once)

1. Open the vote Google Sheet → **Extensions → Apps Script**.
2. Delete the contents of `Code.gs`, paste in `apps-script.gs`, save.
3. Run the `setupHeaders` function once and approve the permission prompt.
   This writes the voter column names and colour-codes the sheet.
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**  ← voters have no Google login
   Deploy, approve, copy the `/exec` URL.
5. Paste that URL into `window.SETLIST_API` in `config.js`.
6. Commit and push. GitHub Pages redeploys in about a minute.

If `SETLIST_API` is left empty, both pages still work — the ballot copies votes
to the clipboard and the results page reads a pasted table instead.

## Changing the song list

Edit the `SONGS` array in `index.html` and the `META` map in `results.html`,
and add matching rows to the sheet. Songs are matched on `Song|Artist`, so the
titles must agree exactly across all three.

## After editing apps-script.gs

Deploy → Manage deployments → edit → Version: **New version** → Deploy.
Without that the live site keeps running the old code.
