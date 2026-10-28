import { readBody } from "./_sheets.js";
import { requireOwner, hasSession, sessionToken, sessionCookie } from "./_auth.js";
import { ok, methodGuard, guarded } from "./_payload.js";

/**
 * The owner's session: type the owner code once per device, not once per page.
 *
 *   GET                     { owner: true|false }
 *   POST {ownerCode}        checks the code, sets the rs_owner cookie (30 days)
 *   POST {logout:true}      clears it
 *
 * Still the same weak gate as the owner code itself — see _auth.js.
 */
export default async function handler(req, res) {
  if (methodGuard(req, res, ["GET", "POST"])) return;
  return guarded(res, async () => {
    if (req.method === "GET") return ok(res, { owner: hasSession(req) });
    const body = await readBody(req);
    if (body.logout) {
      res.setHeader("Set-Cookie", sessionCookie(req, ""));
      return ok(res, { owner: false });
    }
    // The code itself, not an existing session: signing in again must prove it.
    requireOwner({ ownerCode: body.ownerCode ?? body.key });
    res.setHeader("Set-Cookie", sessionCookie(req, sessionToken()));
    return ok(res, { owner: true });
  });
}
