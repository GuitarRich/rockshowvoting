import { test } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.js";
import { makeFakeSheets } from "./fakeSheets.js";
import { twoShows } from "./nov.fixture.js";
import { setSheetsClient } from "../api/_sheets.js";
import { sessionToken, SESSION_SECONDS } from "../api/_auth.js";
import session from "../api/session.js";
import admin from "../api/admin.js";
import vote from "../api/vote.js";
import shows from "../api/shows.js";

const fresh = () => setSheetsClient(makeFakeSheets(twoShows()));
const cookieOf = (r) => String(r.headers["set-cookie"] || "").split(";")[0];

test("signing in with the owner code sets a session cookie", async () => {
  fresh();
  const bad = await call(session, { method: "POST", body: { ownerCode: "band" } });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers["set-cookie"], undefined);

  const good = await call(session, { method: "POST", body: { ownerCode: "owner" }, headers: { host: "example.com" } });
  assert.equal(good.status, 200);
  const set = good.headers["set-cookie"];
  assert.match(set, /^rs_owner=\d+\.[\w-]+; /);
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  assert.match(set, /Secure/);
  assert.match(set, new RegExp("Max-Age=" + SESSION_SECONDS));

  const me = await call(session, { headers: { cookie: cookieOf(good) } });
  assert.equal(me.json.owner, true);
  assert.equal((await call(session)).json.owner, false);
});

test("the cookie stands in for the owner code on every owner call", async () => {
  fresh();
  const cookie = "rs_owner=" + sessionToken();
  const a = await call(admin, { method: "POST", body: { show: "nov", maxSongs: 5 }, headers: { cookie } });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  const s = await call(shows, { method: "POST", body: { update: { id: "nov" } }, headers: { cookie } });
  assert.equal(s.status, 200);
  const p = await call(vote, {
    method: "POST", body: { show: "nov", code: "band", voter: "Joel", votes: {}, pool: true }, headers: { cookie },
  });
  assert.equal(p.status, 200);
});

test("a forged, expired or old-secret cookie grants nothing", async () => {
  fresh();
  const send = (cookie) => call(admin, { method: "POST", body: { show: "nov", maxSongs: 5 }, headers: { cookie } });
  const [exp] = sessionToken().split(".");
  assert.equal((await send("rs_owner=" + exp + ".forged")).status, 403);
  assert.equal((await send("rs_owner=" + sessionToken(Date.now() - (SESSION_SECONDS + 60) * 1000))).status, 403);
  const old = sessionToken();
  process.env.OWNER_SECRET = "rotated";
  try {
    assert.equal((await send("rs_owner=" + old)).status, 403, "changing OWNER_SECRET signs everyone out");
  } finally {
    process.env.OWNER_SECRET = "owner";
  }
});

test("signing out clears the cookie", async () => {
  fresh();
  const r = await call(session, { method: "POST", body: { logout: true }, headers: { host: "localhost:8900" } });
  assert.equal(r.status, 200);
  assert.match(r.headers["set-cookie"], /^rs_owner=; .*Max-Age=0/);
  assert.doesNotMatch(r.headers["set-cookie"], /Secure/, "plain-http localhost has to accept it");
});

test("closing voting stops band votes, but not the owner", async () => {
  fresh();
  const close = await call(admin, { method: "POST", body: { show: "nov", ownerCode: "owner", settings: { votingClosed: true } } });
  assert.equal(close.status, 200, JSON.stringify(close.json));
  assert.equal(close.json.data.show.votingClosed, true);

  const ballot = { show: "nov", code: "band", voter: "Joel", votes: {} };
  const shut = await call(vote, { method: "POST", body: ballot });
  assert.equal(shut.status, 409);
  assert.match(shut.json.error, /closed/i);

  const owner = await call(vote, { method: "POST", body: ballot, headers: { cookie: "rs_owner=" + sessionToken() } });
  assert.equal(owner.status, 200);
  const edit = await call(admin, { method: "POST", body: { show: "nov", ownerCode: "owner", maxSongs: 6 } });
  assert.equal(edit.status, 200, "the owner can still change the show");

  const other = await call(vote, { method: "POST", body: { show: "oct", voter: "Rich", votes: {} } });
  assert.equal(other.status, 200, "closing one show leaves the others open");

  await call(admin, { method: "POST", body: { show: "nov", ownerCode: "owner", settings: { votingClosed: false } } });
  assert.equal((await call(vote, { method: "POST", body: ballot })).status, 200);
});
