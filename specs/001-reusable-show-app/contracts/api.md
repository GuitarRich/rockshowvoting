# API Contract

Every endpoint is same-origin under `/api`.

**Responses**
- Every response is JSON: `{ok: true, ...}` on success, or `{ok: false, error: string}` on failure.
- The `Cache-Control: no-store` header is set on every response.
- Each endpoint accepts one HTTP method. Any other method gets 405.

**Choosing a show**
- Every endpoint takes a `show` value: from the query string on GET, or from the body on POST.
- If `show` is left out, the endpoint uses `oct`. This keeps October's current pages working unchanged.
- An unknown show id gets 404.

**Codes**

| Code | Where it goes | When it is required |
|---|---|---|
| `code` (band code) | request body | Every POST to a show whose `RequireBandCode` is TRUE. Missing or wrong: 401 `"Wrong band code."` |
| `ownerCode` | request body | Every owner action. Missing or wrong: 403 `"Wrong owner code."` Checked against `OWNER_SECRET`, or `APP_SECRET` if that is unset. For backward compatibility the October admin page may send it as `key`. |

A POST to a show whose status is `past` gets 409 `"This show has finished and is read-only."`

## Read

| Endpoint | Method | Returns |
|---|---|---|
| `/api/shows` | GET | `{shows: [{id, name, gigDate, status, requireBandCode}], defaultId}` |
| `/api/data?show=` | GET | Everything described below |
| `/api/health` | GET | Which env vars are set, whether the key is well-formed, the sheet title, a list of tabs by show, and `hint` text |

**What `/api/data` returns.** It keeps today's Rock Show payload and adds fields. Every existing field keeps its name and meaning.

- `show`: `{id, name, occasion, bandName, owner, gigDate, status, requireBandCode}`
- `settings`: `{budgetSeconds, gapSeconds, maxSongs, maxPerArtist, warnings, leads, eras}`
- `voters`, `band`, `learners`, `learnValues`, `weights`, `limits`, `availability`, `gigDate`
- `set`: `{count, seconds, locked, maxSongs, blocked, badLengths, order: [songKey]}`
- `rows[]`:
  - Existing fields: `k, section, song, artist, lead, len, energy, tags, order, force, keyboard, tuning, votes, learn, inSet`
  - New fields:
    - `year`, `era`
    - `bpm`, `beats`, `bpmSource`: `bpmSource` is `"set"`, `"est"` or `"none"`
    - `hasLyrics`
    - `cut`: why the song missed the set, one of `"veto"`, `"cap"`, `"room"`, `"out"`, or null
- `lyrics` is **not** in this payload, because it is too large. Fetch it with `/api/lyrics`.

`GET /api/lyrics?show=` returns `{lyrics: {songKey: text}}` for the songs in the set. Add `&all=1` to get every song on the ballot.

## Write

| Endpoint | Body (besides `show`, `code`) | Who | What it does |
|---|---|---|---|
| `/api/vote` | `{voter, votes: {"Song\|Artist" or songKey: value}}` | a voter | Unchanged from today, plus the code gating above |
| `/api/learn` | `{person, learn}` | a band member | Unchanged |
| `/api/availability` | `{person, days}` | a band member | Unchanged |
| `/api/lyrics` | `{key, lyrics}` or `{addBlankRows: true}` | anyone with the code | Upserts one `Lyrics` row (at most 20,000 characters). Library-level, so every show sees it |
| `/api/tempos` | `{key, bpm (30–300), beats (2–7)}` | anyone with the code | Upserts one `Tempos` row. Library-level |
| `/api/admin` | `{ownerCode, add, update, remove, force, keyboard, order, clearOrder, maxSongs, lockSet, gigDate, settings}` | owner | Today's operations, plus `settings: {key: value}` for the show-settings keys in data-model.md |
| `/api/shows` | `{ownerCode, create: {id, name, gigDate, copyFrom?}}` or `{ownerCode, update: {id, status?, name?, gigDate?, requireBandCode?}}` | owner | Creates the show's prefixed tabs (and copies Songs and Settings when `copyFrom` is given), or updates its registry row |

**How the old Band Vote requests map**
- `POST /api/votes` becomes `POST /api/vote`, and vote values change from integers to strings (for example `3` becomes `MUST`).
- `POST /api/plan {kind: "setlist"}` becomes `POST /api/admin` (`force`, `order`, `maxSongs`).
- `POST /api/plan {kind: "progress"}` becomes `POST /api/learn`.

Band Vote's front end is rewritten against the endpoints above. It does not get a compatibility layer.

## Server-side rules

These are enforced on the server, and the tests assert them:

- A name not on the show's `voters` list is refused by `/api/vote`. A name not on its `band` list is refused by `/api/learn` and `/api/availability`.
- Votes on LOCKED songs are ignored, except in pick-one sections.
- Every owner action needs `ownerCode`. Typing the owner's name grants nothing.
- Only the targeted person's row is written (a per-person upsert). Library tabs are only ever written one row at a time.
