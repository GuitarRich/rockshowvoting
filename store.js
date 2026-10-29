/**
 * What every page shares in the browser: which show it is looking at, the
 * band code, who "I" am, and the calls to the API.
 *
 * The show comes from the page's own link (?show=nov). A link with none opens
 * whichever show is next by gig date, so an old bookmark still lands somewhere
 * sensible. Every localStorage touch is wrapped: private windows and blocked
 * storage must not break a page.
 */
export const API = "/api";

const store = {
  get(k) {
    try { return localStorage.getItem(k) || ""; } catch (e) { return ""; }
  },
  set(k, v) {
    try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { /* storage off */ }
  },
};

export function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/** The show named in this page's link, or "" when it names none. */
export function linkedShow() {
  try {
    return (new URLSearchParams(location.search).get("show") || "").trim().toLowerCase();
  } catch (e) {
    return "";
  }
}

let SHOWS = null;
export async function getShows() {
  if (SHOWS) return SHOWS;
  const r = await fetch(API + "/shows", { cache: "no-store" });
  const d = await r.json();
  if (!r.ok || !d.ok) throw new Error(d.error || "HTTP " + r.status);
  SHOWS = d;
  return d;
}

/** The show this page should show: the link's, else the default. */
export async function currentShowId() {
  const linked = linkedShow();
  if (linked) return linked;
  try {
    return (await getShows()).defaultId || "oct";
  } catch (e) {
    return store.get("rs_last_show") || "oct";   // offline: the show this device last opened
  }
}

/* ----- band code: remembered per device, per show — each band has its own ----- */
export const bandCode = (show) => store.get("rs_code_" + show);
export const setBandCode = (show, c) => store.set("rs_code_" + show, String(c || "").trim());

/* ----- who I am: the key the learn and availability pages already use ----- */
export const me = () => store.get("setlist.me");
export const setMe = (n) => store.set("setlist.me", n);

/* ----- owner session: the server's rs_owner cookie, typed once per device ----- */
let OWNER = null;
/** Resolves to true when this browser holds a live owner session. */
export function ownerSession() {
  OWNER ||= fetch(API + "/session", { cache: "no-store" })
    .then((r) => r.json()).then((d) => !!(d && d.owner)).catch(() => false);
  return OWNER;
}
/** Check the owner code and start a session; throws on a wrong code. */
export async function ownerLogin(code) {
  const r = await fetch(API + "/session", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerCode: String(code || "").trim() }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw apiError(r, d);
  OWNER = Promise.resolve(true);
  return true;
}
export async function ownerLogout() {
  OWNER = Promise.resolve(false);
  await fetch(API + "/session", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logout: true }),
  }).catch(() => {});
}
/** Forget a session the server has stopped accepting (a 403 on an owner call). */
export function ownerExpired() {
  OWNER = Promise.resolve(false);
}

/** An error that knows its HTTP status, so a 401 can ask for the code again. */
function apiError(res, d) {
  return Object.assign(new Error((d && d.error) || "HTTP " + res.status), { status: res.status });
}

/**
 * The owner never needs a band code (the server takes the owner's session in
 * its place), so for the owner every show reads as one that asks for none,
 * and no page ever prompts for it.
 */
async function ownerView(data) {
  if (data && data.show && data.show.requireBandCode && await ownerSession()) {
    data.show.requireBandCode = false;
  }
  return data;
}

/**
 * A GET that gives up after `ms` (0 = wait as long as the browser does). On a
 * stage with one bar of signal a request can hang for a minute; better to fall
 * back to the saved copy in a few seconds.
 */
async function getJson(url, ms) {
  const ctl = ms ? new AbortController() : null;
  const timer = ctl && setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { cache: "no-store", signal: ctl ? ctl.signal : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw apiError(r, d);
    return d;
  } finally {
    clearTimeout(timer);
  }
}

/* ----- the last copy this device saw, kept for when there is no signal ----- */
function keep(kind, show, value) {
  try { localStorage.setItem("rs_" + kind + "_" + show, JSON.stringify({ at: Date.now(), value })); } catch (e) { /* full or off */ }
}
function kept(kind, show) {
  try { return JSON.parse(localStorage.getItem("rs_" + kind + "_" + show) || "null"); } catch (e) { return null; }
}

export async function getData(show, ms = 0) {
  const d = await getJson(API + "/data?show=" + encodeURIComponent(show), ms);
  keep("last", show, d.data);
  store.set("rs_last_show", show);
  await ownerView(d.data);
  await noteBallot(show, d.data);
  return d.data;
}

/** The last set this device loaded for a show: { at, value } or null. */
export const lastData = (show) => kept("last", show);

export async function getLyrics(show, all, ms = 0) {
  const d = await getJson(API + "/lyrics?show=" + encodeURIComponent(show) + (all ? "&all=1" : ""), ms);
  if (!all) keep("lyrics", show, d.lyrics || {});
  return d.lyrics || {};
}

/** The last lyrics this device loaded for a show: { at, value } or null. */
export const lastLyrics = (show) => kept("lyrics", show);

/**
 * POST to the API with the show and the band code attached. A 401 forgets
 * the stored code, so the page's next attempt asks for it afresh.
 */
export async function post(path, show, body) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ show, code: bandCode(show), ...body }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) setBandCode(show, "");
  if (!r.ok || !d.ok) throw apiError(r, d);
  if (d.data) { await ownerView(d.data); await noteBallot(show, d.data); }
  return d;
}

export const saveLyric = (show, key, lyrics) => post("/lyrics", show, { key, lyrics });
export const addBlankLyricRows = (show) => post("/lyrics", show, { addBlankRows: true });
export const saveTempo = (show, key, bpm, beats) => post("/tempos", show, { key, bpm, beats });

/* ----- closed voting: the ballot is no page to visit, so the nav drops it ----- */
const BALLOT = "vote.html";
/** True when this device last saw the show's voting closed (the owner never does). */
export const ballotShut = (show) => store.get("rs_shut_" + show) === "1";
/**
 * Remember whether the ballot is shut to this viewer and show or hide the
 * Vote link to match. Pages without the show's data (rehearsals, admin) go by
 * what this device saw last.
 */
async function noteBallot(show, data) {
  const shut = !!(data && data.show && data.show.votingClosed) && !(await ownerSession());
  store.set("rs_shut_" + show, shut ? "1" : "");
  if (typeof document === "undefined") return;
  document.querySelectorAll('#nav a[data-page="' + BALLOT + '"]').forEach((a) => { a.style.display = shut ? "none" : ""; });
}

/** A link to another page of the same show. */
export function link(page, show) {
  return "./" + pageFor(page, show) + (show ? "?show=" + encodeURIComponent(show) : "");
}

export const PAGES = [
  ["vote.html", "Vote"],
  ["setlist.html", "Setlist"],
  ["lyrics.html", "Lyrics"],
  ["click.html", "Click"],
  ["availability.html", "Rehearsals"],
  ["shows.html", "Admin"],
];

/** Kept so older links still resolve: every show now uses the same pages. */
export function pageFor(page) {
  return page;
}

/** The nav every page carries, with the current page marked. */
export function navHtml(show, current) {
  return PAGES.map(([page, label]) => {
    const real = pageFor(page, show);
    return '<a href="' + esc(link(real, show)) + '" data-page="' + esc(page) + '"' +
      (page === BALLOT && ballotShut(show) ? ' style="display:none"' : "") +
      (page === current || real === current ? ' aria-current="page"' : "") + ">" + esc(label) + "</a>";
  }).join("");
}

/**
 * A show switcher: every show, past ones labelled read-only. Changing it
 * reloads the page on the other show.
 */
export async function showSwitcher(show) {
  let list = [];
  try { list = (await getShows()).shows || []; } catch (e) { return ""; }
  if (list.length < 2) return "";
  return '<select class="showpick" aria-label="Show">' + list.map((s) =>
    '<option value="' + esc(s.id) + '"' + (s.id === show ? " selected" : "") + ">" +
      esc(s.name) + (s.status === "past" ? " (past, read-only)" : "") + "</option>").join("") + "</select>";
}

export function wireSwitcher(root) {
  const sel = root && root.querySelector(".showpick");
  if (!sel) return;
  sel.onchange = () => {
    const u = new URL(location.href);
    u.searchParams.set("show", sel.value);
    location.href = u.toString();
  };
}
