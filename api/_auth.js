/**
 * The two shared codes. Neither is authentication in any real sense — they
 * stop a stranger with the link writing to the sheet, and a bandmate changing
 * the set by accident. Say so wherever they are described.
 *
 *   band code   each show's own code (its Settings tab, key bandCode), or
 *               BAND_SECRET where a show has none. Every write, on shows that
 *               ask for it. A show's own code works for that show only, so
 *               one band cannot save to another band's show.
 *               The owner code (or session) passes wherever the band code would.
 *   owner code  OWNER_SECRET every owner action (falls back to APP_SECRET, the
 *                            key October's admin page has always used)
 *
 * Typing the owner's name grants nothing: only the owner code does.
 *
 * Once the owner code has been typed, the browser keeps a signed cookie
 * (rs_owner) for 30 days, so every page and every owner call after that
 * works without retyping it. The cookie holds an expiry and an HMAC of it
 * keyed on the owner code: nothing to store server-side, and changing
 * OWNER_SECRET signs every device out at once.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const clean = (v) => String(v ?? "").trim().replace(/^(['"])(.*)\1$/, "$2").trim();
const err = (status, message) => Object.assign(new Error(message), { status });

/** The band code, on shows that ask for one. The owner never needs it. */
export function requireBand(show, body, settings, req) {
  if (!show || !show.requireBandCode) return;
  if (isOwner(body, req)) return;
  const secret = clean(settings && settings.bandCode) || clean(process.env.BAND_SECRET);
  if (!secret) throw err(500, "This show has no band code yet. Set one on the shows page.");
  if (clean(body && body.code) !== secret) throw err(401, "Wrong band code.");
}

const ownerSecret = () => clean(process.env.OWNER_SECRET) || clean(process.env.APP_SECRET);

export const SESSION_COOKIE = "rs_owner";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

const sign = (exp, secret) => createHmac("sha256", secret).update("owner-session:" + exp).digest("base64url");

/** A fresh session token, good for SESSION_SECONDS from `now`. */
export function sessionToken(now = Date.now()) {
  const secret = ownerSecret();
  if (!secret) throw err(500, "OWNER_SECRET is not set on the server.");
  const exp = Math.floor(now / 1000) + SESSION_SECONDS;
  return exp + "." + sign(exp, secret);
}

function cookieValue(req, name) {
  const raw = String((req && req.headers && req.headers.cookie) || "");
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}

/** True when the request carries an unexpired session cookie signed with today's owner code. */
export function hasSession(req, now = Date.now()) {
  const secret = ownerSecret();
  if (!secret) return false;
  const [exp, mac] = cookieValue(req, SESSION_COOKIE).split(".");
  if (!/^\d+$/.test(exp || "") || !mac) return false;
  if (Number(exp) * 1000 <= now) return false;
  const want = Buffer.from(sign(exp, secret));
  const got = Buffer.from(mac);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * The Set-Cookie header for a session, or for clearing one. HttpOnly, so a
 * page's script never sees it; Secure everywhere but plain-http localhost.
 */
export function sessionCookie(req, token) {
  const host = String((req && req.headers && req.headers.host) || "");
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return [
    SESSION_COOKIE + "=" + (token || ""),
    "Path=/", "HttpOnly", "SameSite=Strict",
    "Max-Age=" + (token ? SESSION_SECONDS : 0),
    ...(local ? [] : ["Secure"]),
  ].join("; ");
}

/** The owner code in the body, or a live session cookie on the request. */
export function isOwner(body, req) {
  const secret = ownerSecret();
  if (!secret) return false;
  const given = clean(body && (body.ownerCode ?? body.key));
  if (given !== "" && given === secret) return true;
  return hasSession(req);
}

export function requireOwner(body, req) {
  if (!ownerSecret()) throw err(500, "OWNER_SECRET is not set on the server.");
  if (!isOwner(body, req)) throw err(403, "Wrong owner code.");
}

export function requireWritable(show) {
  if (show && show.status === "past") throw err(409, "This show has finished and is read-only.");
}

/** Votes stop once the owner closes voting; the owner can still change anything. */
export function requireVotingOpen(settings, body, req) {
  if (settings && settings.votingClosed && !isOwner(body, req)) {
    throw err(409, "Voting has closed for this show.");
  }
}
