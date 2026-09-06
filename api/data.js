import { readAll } from "./_sheets.js";
import { buildPayload, ok, fail, methodGuard } from "./_payload.js";

/** Everything every page needs, in one call. */
export default async function handler(req, res) {
  if (methodGuard(req, res, "GET")) return;
  try {
    return ok(res, { data: buildPayload(await readAll()) });
  } catch (e) {
    return fail(res, 500, e.message);
  }
}
