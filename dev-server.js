/**
 * Offline dev server. Serves the pages and runs the REAL api/*.js handlers
 * against an in-memory fake sheet, so a UI change is exercised through the
 * same code the live site runs — with no Google credentials and no network.
 *
 *     pnpm dev          then open http://localhost:8900
 *
 * Seeded with October (from the captured fixture) and a November show built
 * from the frozen Band Vote catalog with patterned votes. Band code: band.
 * Owner code: owner. State lives in this process and is gone when you stop it.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeFakeSheets } from "./test/fakeSheets.js";
import { setSheetsClient, HEADERS } from "./api/_sheets.js";
import { buildNovTabs } from "./scripts/lib/bandvote-map.js";

process.env.SHEET_ID = process.env.SHEET_ID || "dev";
process.env.BAND_SECRET = "band";
process.env.OWNER_SECRET = "owner";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8900;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function seed() {
  const oct = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/oct-sheet.json")));
  const { tracks } = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/fixtures/bandvote-tracks-v32.json")));
  const PATTERNS = { Rich: [3, 2, 1, 0, 2, 3], Joel: [2, 3, 0, 1, 2, 1], Anders: [1, 2, 3, 2, 0, 3], Pete: [3, 1, 2, 3, 1, 0] };
  const voteRows = Object.entries(PATTERNS).map(([n, p]) => {
    const v = {};
    tracks.forEach((t, i) => { v["b" + i] = p[i % p.length]; });
    return [n, "1", "dev", String(tracks.length), JSON.stringify(v)];
  });
  const nov = buildNovTabs({
    tracks, addedRows: [], voteRows, setlistRows: [], progressRows: [["Key", "Title", "Artist"]],
    settingsRows: [["Song limit", "17"]], lyricsRows: [
      ["iwannabeyourdog-thestooges", "I Wanna Be Your Dog", "The Stooges",
        "[Verse 1]\nE           A      E\nSo messed up, I want you here\n\n[Chorus]\n[E]Now I wanna [A]be your [E]dog"],
    ],
    tempoRows: [], tuningRows: [], existing: { tunings: {}, lyrics: {}, tempos: {}, library: new Set() },
    gigDate: "2026-11-21",
  });
  const H = HEADERS;
  return makeFakeSheets({
    ...oct,
    Shows: [H.SHOW_HEADERS,
      ["oct", "", "October Anniversary Show", "2026-10-24", "current", "FALSE"],
      ["nov", "nov·", "Bun's & Roses", "2026-11-21", "current", "TRUE"]],
    "nov·Songs": [H.SONG_HEADERS, ...nov.tabs.Songs],
    "nov·Votes": [H.VOTE_HEADERS, ...nov.tabs.Votes],
    "nov·Learning": [H.LEARN_HEADERS, ...nov.tabs.Learning],
    "nov·Settings": [H.SETTINGS_HEADERS, ...nov.tabs.Settings],
    Library: [H.LIBRARY_HEADERS, ...nov.library.Library],
    Lyrics: [H.LYRICS_HEADERS, ...nov.library.Lyrics],
  }, { title: "Dev sheet" });
}

setSheetsClient(seed());

const handlers = {};
async function handlerFor(name) {
  if (!/^[a-z]+$/.test(name)) return null;
  const file = path.join(ROOT, "api", name + ".js");
  if (!fs.existsSync(file)) return null;
  handlers[name] ||= (await import(pathToFileURL(file).href)).default;
  return handlers[name];
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const h = await handlerFor(url.pathname.slice(5));
    if (!h) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "No such endpoint." }));
    }
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (e) { /* handler sees {} */ }
    const vreq = { method: req.method, query: Object.fromEntries(url.searchParams), body, headers: req.headers };
    let status = 200;
    const vres = {
      setHeader: (k, v) => res.setHeader(k, v),
      status(c) { status = c; return vres; },
      json(o) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); return vres; },
      end() { res.end(); return vres; },
    };
    try {
      await h(vreq, vres);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`Dev server on http://localhost:${PORT}  (fake sheet; band code "band", owner code "owner")`);
});
