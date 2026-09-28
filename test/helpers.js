/**
 * Call a Vercel-style handler directly, with a fake req/res. Pairs with
 * test/fakeSheets.js and setSheetsClient() so the real API code runs
 * end to end with no network.
 */
process.env.SHEET_ID = "test";
process.env.BAND_SECRET = "band";
process.env.OWNER_SECRET = "owner";

export async function call(handler, { method = "GET", query = {}, body } = {}) {
  const headers = {};
  let status = 200;
  let json;
  const req = { method, query, body: body || {}, headers: {} };
  const res = {
    setHeader(k, v) {
      headers[k.toLowerCase()] = v;
    },
    status(code) {
      status = code;
      return res;
    },
    json(obj) {
      json = obj;
      return res;
    },
    end() {
      return res;
    },
  };
  await handler(req, res);
  return { status, json, headers };
}
