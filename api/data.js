import { readAll, resolveShow } from "./_sheets.js";
import { buildPayload, ok, methodGuard, guarded, showParam } from "./_payload.js";

/** Everything every page needs, in one call. `?show=` picks the show. */
export default async function handler(req, res) {
  if (methodGuard(req, res, "GET")) return;
  return guarded(res, async () => {
    const show = await resolveShow(showParam(req));
    return ok(res, { data: buildPayload(await readAll(show)) });
  });
}
