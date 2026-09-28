import { sheetsClient, sheetId, ensureTabs, readShows, tabName, TABS } from "./_sheets.js";

/**
 * Diagnosis endpoint. Build and check this before anything else — it turns
 * every "it doesn't work" into a one-look answer. Never returns secrets,
 * only whether each one is present and whether the key is shaped right.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const out = {
    env: {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      GOOGLE_PRIVATE_KEY: !!process.env.GOOGLE_PRIVATE_KEY,
      SHEET_ID: !!process.env.SHEET_ID,
      APP_SECRET: !!process.env.APP_SECRET,
      BAND_SECRET: !!process.env.BAND_SECRET,
      OWNER_SECRET: !!process.env.OWNER_SECRET,
    },
    owner: process.env.OWNER_NAME || "Rich",
  };

  if (process.env.GOOGLE_PRIVATE_KEY) {
    const k = process.env.GOOGLE_PRIVATE_KEY;
    out.keyLooksRight =
      k.includes("BEGIN PRIVATE KEY") && (k.includes("\\n") || k.includes("\n"));
  }
  // Surfaced so a 403 can be diagnosed without opening the Vercel dashboard:
  // this is the address the sheet must be shared with.
  out.serviceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null;

  try {
    const sheets = sheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId() });
    out.sheetTitle = meta.data.properties.title;
    out.tabs = meta.data.sheets.map((s) => s.properties.title);
    await ensureTabs();
    out.tabsAfterEnsure = (
      await sheets.spreadsheets.get({ spreadsheetId: sheetId() })
    ).data.sheets.map((s) => s.properties.title);
    // Every show, and whether each of its tabs is there.
    const all = new Set(out.tabsAfterEnsure);
    const shows = await readShows();
    out.shows = shows.map((s) => ({
      id: s.id, name: s.name, status: s.status, requireBandCode: s.requireBandCode,
      tabs: [TABS.SONGS_TAB, TABS.VOTES_TAB, TABS.LEARN_TAB, TABS.SETTINGS_TAB, TABS.AVAIL_TAB]
        .map((t) => tabName(s, t) + (all.has(tabName(s, t)) ? "" : " (missing)")),
    }));
    out.libraryTabs = [TABS.TUNINGS_TAB, TABS.LYRICS_TAB, TABS.TEMPOS_TAB, TABS.LIBRARY_TAB]
      .map((t) => t + (all.has(t) ? "" : " (missing)"));
    if (shows.some((s) => s.requireBandCode) && !process.env.BAND_SECRET) {
      out.warning = "A show asks for the band code but BAND_SECRET is not set, so its saves will fail. Set it in Vercel and redeploy.";
    }
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = e.message;
    if (/permission|forbidden|403/i.test(e.message)) {
      out.hint = `Share the sheet with ${out.serviceAccount || "the service account email"} as an Editor.`;
    } else if (/DECODER|PEM|key/i.test(e.message)) {
      out.hint =
        "GOOGLE_PRIVATE_KEY is malformed — paste the whole key including the BEGIN/END lines.";
    } else if (/not found|404/i.test(e.message)) {
      out.hint = "SHEET_ID does not match a spreadsheet the service account can see.";
    } else if (/Missing /.test(e.message)) {
      out.hint = "Set the environment variables in Vercel, then redeploy — env changes do not apply to existing builds.";
    }
  }

  return res.status(out.ok ? 200 : 500).json(out);
}
