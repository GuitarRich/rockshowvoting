/**
 * Duplicate every tab of the live sheet into a hidden `bak-YYYYMMDD·<Tab>`.
 * Run before any script writes to the sheet; the migration scripts refuse to
 * --apply without a backup from today.
 *
 *     pnpm backup        (reads credentials from .env.development.local)
 *
 * Only ever adds tabs. Skips existing bak- tabs, and anything already backed
 * up today, so running it twice is harmless.
 */
import { pathToFileURL } from "node:url";
import { sheetsClient, sheetId } from "../api/_sheets.js";

export const BACKUP_PREFIX = "bak-";

export function today(d = new Date()) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function backupSheet({ sheets = sheetsClient(), id = sheetId(), stamp = today(), log = console.log } = {}) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const all = meta.data.sheets.map((s) => s.properties);
  const titles = new Set(all.map((p) => p.title));
  const made = [];
  for (const p of all) {
    if (p.title.startsWith(BACKUP_PREFIX)) continue;
    const name = `${BACKUP_PREFIX}${stamp}·${p.title}`;
    if (titles.has(name)) {
      log(`skip   ${name} (already backed up today)`);
      continue;
    }
    const r = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [{ duplicateSheet: { sourceSheetId: p.sheetId, newSheetName: name, insertSheetIndex: all.length + made.length } }],
      },
    });
    const newId = r.data.replies[0].duplicateSheet.properties.sheetId;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId: newId, hidden: true }, fields: "hidden" } }] },
    });
    made.push(name);
    log(`backup ${p.title} → ${name}`);
  }
  return made;
}

/** True when every non-backup tab has a backup stamped today. */
export async function hasBackupToday({ sheets = sheetsClient(), id = sheetId(), stamp = today() } = {}) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const titles = meta.data.sheets.map((s) => s.properties.title);
  return titles.some((t) => t.startsWith(`${BACKUP_PREFIX}${stamp}·`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const made = await backupSheet();
  console.log(`${made.length} tab(s) backed up.`);
}
