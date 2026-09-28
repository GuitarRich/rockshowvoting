/**
 * The two shared codes. Neither is authentication in any real sense — they
 * stop a stranger with the link writing to the sheet, and a bandmate changing
 * the set by accident. Say so wherever they are described.
 *
 *   band code   BAND_SECRET  every write, on shows that ask for it
 *   owner code  OWNER_SECRET every owner action (falls back to APP_SECRET, the
 *                            key October's admin page has always used)
 *
 * Typing the owner's name grants nothing: only the owner code does.
 */
const clean = (v) => String(v ?? "").trim().replace(/^(['"])(.*)\1$/, "$2").trim();
const err = (status, message) => Object.assign(new Error(message), { status });

export function requireBand(show, body) {
  if (!show || !show.requireBandCode) return;
  const secret = clean(process.env.BAND_SECRET);
  if (!secret) throw err(500, "BAND_SECRET is not set on the server.");
  if (clean(body && body.code) !== secret) throw err(401, "Wrong band code.");
}

export function isOwner(body) {
  const secret = clean(process.env.OWNER_SECRET) || clean(process.env.APP_SECRET);
  if (!secret) return false;
  const given = clean(body && (body.ownerCode ?? body.key));
  return given !== "" && given === secret;
}

export function requireOwner(body) {
  const secret = clean(process.env.OWNER_SECRET) || clean(process.env.APP_SECRET);
  if (!secret) throw err(500, "OWNER_SECRET is not set on the server.");
  if (!isOwner(body)) throw err(403, "Wrong owner code.");
}

export function requireWritable(show) {
  if (show && show.status === "past") throw err(409, "This show has finished and is read-only.");
}
