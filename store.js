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
    return "oct";
  }
}

/* ----- band code: remembered, per device ----- */
export const bandCode = () => store.get("rs_code");
export const setBandCode = (c) => store.set("rs_code", String(c || "").trim());

/* ----- who I am: the key the learn and availability pages already use ----- */
export const me = () => store.get("setlist.me");
export const setMe = (n) => store.set("setlist.me", n);

/** An error that knows its HTTP status, so a 401 can ask for the code again. */
function apiError(res, d) {
  return Object.assign(new Error((d && d.error) || "HTTP " + res.status), { status: res.status });
}

export async function getData(show) {
  const r = await fetch(API + "/data?show=" + encodeURIComponent(show), { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw apiError(r, d);
  try { localStorage.setItem("rs_last_" + show, JSON.stringify(d.data)); } catch (e) { /* optional */ }
  return d.data;
}

/** The last payload this device saw, for drawing something while offline. */
export function lastData(show) {
  try { return JSON.parse(localStorage.getItem("rs_last_" + show) || "null"); } catch (e) { return null; }
}

export async function getLyrics(show, all) {
  const r = await fetch(API + "/lyrics?show=" + encodeURIComponent(show) + (all ? "&all=1" : ""), { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw apiError(r, d);
  return d.lyrics || {};
}

/**
 * POST to the API with the show and the band code attached. A 401 forgets
 * the stored code, so the page's next attempt asks for it afresh.
 */
export async function post(path, show, body) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ show, code: bandCode(), ...body }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) setBandCode("");
  if (!r.ok || !d.ok) throw apiError(r, d);
  return d;
}

export const saveLyric = (show, key, lyrics) => post("/lyrics", show, { key, lyrics });
export const addBlankLyricRows = (show) => post("/lyrics", show, { addBlankRows: true });
export const saveTempo = (show, key, bpm, beats) => post("/tempos", show, { key, bpm, beats });

/** A link to another page of the same show. */
export function link(page, show) {
  return "./" + pageFor(page, show) + (show ? "?show=" + encodeURIComponent(show) : "");
}

export const PAGES = [
  ["vote.html", "Vote"],
  ["setlist.html", "Setlist"],
  ["learn.html", "Learn"],
  ["lyrics.html", "Lyrics"],
  ["click.html", "Click"],
  ["availability.html", "Rehearsals"],
];

/** Kept so older links still resolve: every show now uses the same pages. */
export function pageFor(page) {
  return page;
}

/** The nav every page carries, with the current page marked. */
export function navHtml(show, current) {
  return PAGES.map(([page, label]) => {
    const real = pageFor(page, show);
    return '<a href="' + esc(link(real, show)) + '"' +
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
