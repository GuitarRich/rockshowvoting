/**
 * The header every page shares. A page declares
 *
 *   <header class="apphdr" data-page="availability.html" data-title="Rehearsals"></header>
 *
 * and imports this module. The markup is written straight away (so a page's
 * own script can find #nav, #brand, #switch and #status as soon as it runs),
 * then the show's name, the switcher and the nav are filled in.
 * `data-status="none"` hides the save pill on pages that have no saving.
 */
import { VERSION, esc } from "./setlist.js";
import { currentShowId, getShows, navHtml, showSwitcher, wireSwitcher } from "./store.js";

const el = document.querySelector("header.apphdr");
const page = (el && el.dataset.page) || "";
const title = (el && el.dataset.title) || "";

if (el) {
  el.innerHTML =
    '<div class="wrap"><div class="plate"><div class="lamp"></div>' +
    '<h1><span id="brand">' + esc(title) + '</span><small><span>' + esc(title) + '</span><span>&middot;</span>' +
    '<span class="v" id="ver">' + esc(VERSION) + '</span><span id="switch"></span></small></h1>' +
    '<div class="status' + (el.dataset.status === "none" ? " hide" : "") + '" id="status"' +
    (el.dataset.status === "none" ? ' style="display:none"' : "") + '>Checking</div></div>' +
    '<nav id="nav"></nav></div>';
}

/** Resolves to the show id once the header is filled in. */
export const ready = (async () => {
  const show = await currentShowId();
  if (!el) return show;
  document.getElementById("nav").innerHTML = navHtml(show, page);
  let name = "";
  try {
    const s = ((await getShows()).shows || []).find((x) => x.id === show);
    name = s ? s.name : "";
  } catch (e) { /* offline: the page title stands */ }
  if (name) {
    document.getElementById("brand").textContent = name;
    document.title = name + " — " + title;
  }
  const sw = document.getElementById("switch");
  sw.innerHTML = await showSwitcher(show);
  wireSwitcher(sw);
  return show;
})();

/** Set the save pill: "ok", "warn" or neutral. */
export function setStatus(text, kind) {
  const s = document.getElementById("status");
  if (!s) return;
  s.textContent = text;
  s.className = "status" + (kind ? " " + kind : "");
}
