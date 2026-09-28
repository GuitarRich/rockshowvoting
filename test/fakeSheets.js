/**
 * In-memory stand-in for the Google Sheets v4 client, just wide enough for
 * api/_sheets.js and the scripts. Cells are stored and returned as strings,
 * the way Sheets hands back formatted values, and trailing blanks are trimmed
 * off rows and ranges the way the real API trims them.
 *
 *   const fake = makeFakeSheets({ Songs: [[...header], [...row]] });
 *   setSheetsClient(fake);
 *   fake.snapshot()  // { Songs: [[...]], ... }
 *
 * `timeCells: true` mimics Sheets retyping "3:23" as a time value: any m:ss
 * written or seeded comes back as "3:23:00 AM".
 */

const colNum = (letters) =>
  letters.toUpperCase().split("").reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);

/** "'nov·Songs'!A2:K500" → { tab, r1, c1, r2, c2 } (0-based, inclusive). */
export function parseRange(range) {
  const m = String(range).match(/^(?:'((?:[^']|'')+)'|([^!]+))(?:!(.*))?$/);
  if (!m) throw new Error("Bad range: " + range);
  const tab = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2];
  const a1 = m[3] || "";
  if (!a1) return { tab, r1: 0, c1: 0, r2: Infinity, c2: Infinity };
  const [a, b] = a1.split(":");
  const cell = (s, end) => {
    const mm = String(s).match(/^([A-Z]*)(\d*)$/i);
    if (!mm) throw new Error("Bad cell: " + s);
    const c = mm[1] ? colNum(mm[1]) - 1 : end ? Infinity : 0;
    const r = mm[2] ? Number(mm[2]) - 1 : end ? Infinity : 0;
    return [r, c];
  };
  const [r1, c1] = cell(a, false);
  const [r2, c2] = b ? cell(b, true) : [r1, c1];
  return { tab, r1, c1, r2, c2 };
}

function trimRows(rows) {
  const out = rows.map((r) => {
    const x = r.slice();
    while (x.length && (x[x.length - 1] === "" || x[x.length - 1] == null)) x.pop();
    return x;
  });
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}

export function makeFakeSheets(initial = {}, opts = {}) {
  let nextId = 1;
  const tabs = new Map(); // title -> { id, hidden, rows: string[][] }
  const calls = [];

  const shown = (v) => {
    const s = v == null ? "" : String(v);
    if (opts.timeCells && /^\d{1,2}:[0-5]\d$/.test(s)) return s + ":00 AM";
    return s;
  };

  const addTab = (title, rows = []) => {
    if (tabs.has(title)) throw Object.assign(new Error(`Sheet ${title} exists`), { code: 400 });
    tabs.set(title, { id: nextId++, hidden: false, rows: rows.map((r) => r.map(shown)) });
  };
  for (const [t, rows] of Object.entries(initial)) addTab(t, rows);

  const tabOf = (range) => {
    const p = parseRange(range);
    const t = tabs.get(p.tab);
    if (!t) throw Object.assign(new Error(`Unable to parse range: ${range}`), { code: 400 });
    return { p, t };
  };

  const read = (range) => {
    const { p, t } = tabOf(range);
    const out = [];
    const r2 = Math.min(p.r2, t.rows.length - 1);
    for (let r = p.r1; r <= r2; r++) {
      const row = t.rows[r] || [];
      const c2 = Math.min(p.c2, row.length - 1);
      const cells = [];
      for (let c = p.c1; c <= c2; c++) cells.push(row[c] ?? "");
      out.push(cells);
    }
    return trimRows(out);
  };

  const write = (range, values) => {
    const { p, t } = tabOf(range);
    values.forEach((vals, i) => {
      const r = p.r1 + i;
      while (t.rows.length <= r) t.rows.push([]);
      const row = t.rows[r];
      vals.forEach((v, j) => {
        const c = p.c1 + j;
        while (row.length <= c) row.push("");
        row[c] = shown(v);
      });
    });
  };

  const clear = (range) => {
    const { p, t } = tabOf(range);
    for (let r = p.r1; r <= Math.min(p.r2, t.rows.length - 1); r++) {
      const row = t.rows[r] || [];
      for (let c = p.c1; c <= Math.min(p.c2, row.length - 1); c++) row[c] = "";
    }
  };

  /** Append after the last row that has anything in it, at or below the range start. */
  const append = (range, values) => {
    const { p, t } = tabOf(range);
    let last = p.r1 - 1;
    for (let r = p.r1; r < t.rows.length; r++) {
      if ((t.rows[r] || []).some((c) => c !== "" && c != null)) last = r;
    }
    const start = last + 1;
    const col = String.fromCharCode(65 + p.c1);
    write(`'${p.tab.replace(/'/g, "''")}'!${col}${start + 1}`, values);
  };

  const client = {
    calls,
    spreadsheets: {
      async get() {
        calls.push(["get"]);
        return {
          data: {
            properties: { title: opts.title || "Fake sheet" },
            sheets: [...tabs.entries()].map(([title, t]) => ({
              properties: { title, sheetId: t.id, hidden: t.hidden },
            })),
          },
        };
      },
      async batchUpdate({ requestBody }) {
        calls.push(["batchUpdate", requestBody]);
        if (opts.readOnly) throw Object.assign(new Error("read-only"), { code: 403 });
        const replies = [];
        for (const req of requestBody.requests || []) {
          if (req.addSheet) {
            addTab(req.addSheet.properties.title);
            replies.push({ addSheet: { properties: { title: req.addSheet.properties.title } } });
          } else if (req.duplicateSheet) {
            const d = req.duplicateSheet;
            const src = [...tabs.entries()].find(([, t]) => t.id === d.sourceSheetId);
            if (!src) throw new Error("No sheet " + d.sourceSheetId);
            addTab(d.newSheetName, src[1].rows.map((r) => r.slice()));
            replies.push({ duplicateSheet: { properties: { title: d.newSheetName, sheetId: tabs.get(d.newSheetName).id } } });
          } else if (req.updateSheetProperties) {
            const pr = req.updateSheetProperties.properties;
            const hit = [...tabs.values()].find((t) => t.id === pr.sheetId);
            if (hit && "hidden" in pr) hit.hidden = !!pr.hidden;
            replies.push({});
          } else {
            throw new Error("Fake does not support request " + Object.keys(req)[0]);
          }
        }
        return { data: { replies } };
      },
      values: {
        async get({ range }) {
          calls.push(["values.get", range]);
          return { data: { range, values: read(range) } };
        },
        async batchGet({ ranges }) {
          calls.push(["values.batchGet", ranges]);
          return { data: { valueRanges: ranges.map((range) => ({ range, values: read(range) })) } };
        },
        async update({ range, requestBody }) {
          calls.push(["values.update", range]);
          if (opts.readOnly) throw Object.assign(new Error("read-only"), { code: 403 });
          write(range, requestBody.values);
          return { data: {} };
        },
        async batchUpdate({ requestBody }) {
          calls.push(["values.batchUpdate", requestBody.data.map((d) => d.range)]);
          if (opts.readOnly) throw Object.assign(new Error("read-only"), { code: 403 });
          for (const d of requestBody.data) write(d.range, d.values);
          return { data: {} };
        },
        async append({ range, requestBody }) {
          calls.push(["values.append", range]);
          if (opts.readOnly) throw Object.assign(new Error("read-only"), { code: 403 });
          append(range, requestBody.values);
          return { data: {} };
        },
        async clear({ range }) {
          calls.push(["values.clear", range]);
          if (opts.readOnly) throw Object.assign(new Error("read-only"), { code: 403 });
          clear(range);
          return { data: {} };
        },
      },
    },
    /** Every tab as trimmed rows, for assertions. */
    snapshot() {
      const out = {};
      for (const [title, t] of tabs) out[title] = trimRows(t.rows);
      return out;
    },
    tabNames() {
      return [...tabs.keys()];
    },
  };
  return client;
}
