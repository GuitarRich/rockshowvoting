/**
 * Setlist vote backend — Google Apps Script.
 *
 * The SHEET is the source of truth. The web pages read their song list from
 * here, so adding or removing a song never needs a code change or a push.
 *
 * SETUP (once, ~3 minutes)
 *  1. Open the vote Google Sheet.
 *  2. Extensions -> Apps Script. Delete whatever is in Code.gs and paste this in.
 *  3. Change ADMIN_KEY below to something only you know.
 *  4. Run  setupSheet  once (Run menu). Approve the permission prompt.
 *     Then run  fixLengths  once — it rewrites the Length column as plain text
 *     so Sheets stops turning "3:23" into a time value. If that misbehaves, run
 *     diagnoseLengths first: it changes nothing and prints what is in the cells.
 *     It fixes the voter column names, adds the Energy/Tags columns, widens the
 *     score formulas so new rows keep working, and colour-codes the votes.
 *  5. Deploy -> New deployment -> gear icon -> Web app.
 *        Execute as:       Me
 *        Who has access:   Anyone          <-- voters have no Google login
 *     Deploy, approve, copy the /exec URL.
 *  6. Paste that URL into config.js in the repo, commit and push.
 *
 * After ANY edit to this file: Deploy -> Manage deployments -> edit ->
 * Version: New version -> Deploy. Otherwise the live site runs the old code.
 */

var ADMIN_KEY  = 'change-me-before-deploying';   // <-- CHANGE THIS

var HEADER_ROW = 3;
var FIRST_COL  = 7;    // G — first voter column
var LAST_COL   = 13;   // M — last voter column
var COL_SCORE  = 14;   // N
var COL_MUSTS  = 15;   // O
var COL_ENERGY = 16;   // P
var COL_TAGS   = 17;   // Q
var COL_ORDER  = 18;   // R — manual running order; blank = automatic
var MAX_ROW    = 300;  // formula range ceiling — room to grow
var VOTERS     = ['Rich', 'Ashley', 'CJ', 'Justin', 'Isaac', 'Julie', 'Organiser'];

// Single source of truth for scoring. The sheet formula and both web pages
// are built from this, so changing a number here changes everything.
// Scale is deliberately doubled from the original MUST 3 / YES 1 / NO -2 so
// that votes cast before MAYBE existed keep their exact relative weight.
var WEIGHTS = { MUST: 6, YES: 2, MAYBE: 1, NO: -4 };
var VOTE_VALUES = ['MUST', 'YES', 'MAYBE', 'NO', 'X', ''];

// No more than this many songs by any one band make the final set. Counted
// across locked songs too, so a locked request uses up one of the slots.
// Set to 0 for no limit.
var MAX_PER_ARTIST = 2;

function sheet_() { return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]; }

/** Run once from the editor. Safe to re-run at any time. */
function setupSheet() {
  var sh = sheet_();
  sh.getRange(HEADER_ROW, FIRST_COL, 1, VOTERS.length).setValues([VOTERS]);
  sh.getRange(HEADER_ROW, COL_SCORE, 1, 5)
    .setValues([['SCORE', 'MUSTs', 'Energy', 'Tags', 'Order']]);
  sh.getRange(HEADER_ROW, 1, 1, COL_ORDER)
    .setFontWeight('bold').setBackground('#1d2029').setFontColor('#e9eaf0');
  sh.setFrozenRows(HEADER_ROW);

  var first = HEADER_ROW + 1;
  var vRange = '$G' + first + ':$M' + MAX_ROW;
  var cRange = '$C' + first + ':$C' + MAX_ROW;
  var terms = Object.keys(WEIGHTS).map(function (k) {
    return '(' + vRange + '="' + k + '")*(' + WEIGHTS[k] + ')';
  }).join('+');
  sh.getRange(first, COL_SCORE).setFormula(
    '=ARRAYFORMULA(IF(' + cRange + '="","",MMULT(' + terms + ',SEQUENCE(7,1,1,0))))');
  sh.getRange(first, COL_MUSTS).setFormula(
    '=ARRAYFORMULA(IF(' + cRange + '="","",MMULT(--(' + vRange +
    '="MUST"),SEQUENCE(7,1,1,0))))');

  var last = Math.max(sh.getLastRow(), first);
  var body = sh.getRange(first, FIRST_COL, last - HEADER_ROW, VOTERS.length);
  sh.setConditionalFormatRules([
    ['MUST',  '#e8a33d', '#231a09'],
    ['YES',   '#d6f0e0', '#14532d'],
    ['MAYBE', '#e5e0fb', '#2e1065'],
    ['NO',    '#f8d7d7', '#7f1d1d'],
    ['X',     '#c4b5fd', '#2e1065']
  ].map(function (r) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(r[0]).setBackground(r[1]).setFontColor(r[2])
      .setRanges([body]).build();
  }));
  return 'Sheet ready. Voters: ' + VOTERS.join(', ');
}

/** Shared: turn whatever a Length cell shows into seconds. 0 = unreadable. */
function lenSecs_(raw) {
  var t = String(raw == null ? '' : raw).trim().toUpperCase().replace(/\s*[AP]\.?M\.?$/, '').trim();
  var m = t.match(/^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (!m) return 0;
  var secs;
  if (m[3] === undefined) secs = (+m[1]) * 60 + (+m[2]);
  else {
    secs = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    if (secs > 900) secs = (+m[1]) * 60 + (+m[2]);   // "3:23:00" means 3m23s
  }
  return (secs > 0 && secs <= 900) ? secs : 0;
}

function mmss_(secs) {
  return Math.floor(secs / 60) + ':' + ('0' + (secs % 60)).slice(-2);
}

/** Locate the Length column (0-based). Falls back to column F. */
function lengthCol_(sh) {
  var head = sh.getRange(HEADER_ROW, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  for (var i = 0; i < head.length; i++) {
    if (String(head[i]).trim().toLowerCase() === 'length') return i;
  }
  return 5;   // column F
}

/**
 * READ-ONLY. Run this first if fixLengths misbehaves — it changes nothing and
 * prints exactly what is in the sheet. Open View -> Logs to read the output.
 */
function diagnoseLengths() {
  var sh = sheet_();
  var out = [];
  out.push('Sheet: "' + sh.getName() + '"  rows=' + sh.getLastRow() + '  cols=' + sh.getLastColumn());
  var head = sh.getRange(HEADER_ROW, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  out.push('Header row ' + HEADER_ROW + ': ' + head.join(' | '));
  var col = lengthCol_(sh);
  out.push('Length resolved to column index ' + col + ' (' + String.fromCharCode(65 + col) + ')');

  var n = Math.min(10, Math.max(0, sh.getLastRow() - HEADER_ROW));
  if (!n) { out.push('No data rows.'); Logger.log(out.join('\n')); return out.join('\n'); }

  var rng = sh.getRange(HEADER_ROW + 1, col + 1, n, 1);
  var disp = rng.getDisplayValues();
  var vals = rng.getValues();
  var fmts = rng.getNumberFormats();
  for (var i = 0; i < n; i++) {
    out.push('row ' + (HEADER_ROW + 1 + i) +
      ' | display="' + disp[i][0] + '"' +
      ' | type=' + (vals[i][0] instanceof Date ? 'Date' : typeof vals[i][0]) +
      ' | value=' + vals[i][0] +
      ' | format="' + fmts[i][0] + '"' +
      ' | parsed=' + (lenSecs_(disp[i][0]) || 'UNREADABLE'));
  }
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

/**
 * ONE-TIME REPAIR. Rewrites the Length column as PLAIN TEXT "m:ss" so Sheets
 * stops coercing it into a time value. Safe to re-run. Writes cell by cell so
 * one bad row cannot abort the whole job.
 */
function fixLengths() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last <= HEADER_ROW) return 'Nothing to do — no data rows.';

  var col = lengthCol_(sh) + 1;          // 1-based for getRange
  var n = last - HEADER_ROW;
  var rng = sh.getRange(HEADER_ROW + 1, col, n, 1);
  var disp = rng.getDisplayValues();

  try { rng.setNumberFormat('@'); }      // plain text, so nothing re-coerces
  catch (e) { return 'Could not set the column to plain text: ' + e.message; }

  var fixed = 0, bad = [], failed = [];
  for (var i = 0; i < n; i++) {
    var raw = String(disp[i][0] || '').trim();
    if (!raw) continue;
    var secs = lenSecs_(raw);
    if (!secs) { bad.push('row ' + (HEADER_ROW + 1 + i) + ' "' + raw + '"'); continue; }
    try {
      sh.getRange(HEADER_ROW + 1 + i, col).setValue(mmss_(secs));
      fixed++;
    } catch (e) {
      failed.push('row ' + (HEADER_ROW + 1 + i) + ': ' + e.message);
    }
  }
  SpreadsheetApp.flush();

  var msg = 'Normalised ' + fixed + ' of ' + n + ' lengths to plain text m:ss.';
  if (bad.length)    msg += '  Unreadable (' + bad.length + '): ' + bad.slice(0, 8).join(', ');
  if (failed.length) msg += '  Write failed (' + failed.length + '): ' + failed.slice(0, 5).join(', ');
  Logger.log(msg);
  return msg;
}

function idx_(head) {
  var m = {};
  head.forEach(function (h, i) { m[String(h).trim().toLowerCase()] = i; });
  return m;
}

function readAll_() {
  var sh = sheet_();
  var last = sh.getLastRow(), lastCol = Math.max(sh.getLastColumn(), COL_TAGS);
  var head = sh.getRange(HEADER_ROW, 1, 1, lastCol).getDisplayValues()[0];
  var ix = idx_(head);

  var voters = [];
  for (var c = FIRST_COL - 1; c < LAST_COL; c++) {
    var name = String(head[c] || '').trim();
    if (name) voters.push({ name: name, col: c });
  }

  var rows = [];
  if (last > HEADER_ROW) {
    // getDisplayValues, NOT getValues: Sheets turns "3:23" into a time value, and
    // reading it back as a Date then formatting it is timezone-dependent, which
    // produced wildly wrong runtimes. The displayed string is what the user typed.
    var vals = sh.getRange(HEADER_ROW + 1, 1, last - HEADER_ROW, lastCol).getDisplayValues();
    vals.forEach(function (r, i) {
      var song = String(r[ix['song']] || '').trim();
      if (!song) return;
      var votes = {};
      voters.forEach(function (v) { votes[v.name] = String(r[v.col] || '').trim().toUpperCase(); });
      var tags = String(r[COL_TAGS - 1] || '').trim();
      rows.push({
        row:     HEADER_ROW + 1 + i,
        section: String(r[ix['section']] || '').trim(),
        song:    song,
        artist:  String(r[ix['artist']] || '').trim(),
        lead:    String(r[ix['lead']]   || '').trim().toUpperCase(),
        len:     String(r[ix['length']] || '').trim(),
        energy:  Number(String(r[COL_ENERGY - 1] || '').trim()) || 0,
        tags:    tags ? tags.split(/[,;]\s*/).filter(String) : [],
        order:   Number(String(r[COL_ORDER - 1] || '').trim()) || 0,
        votes:   votes
      });
    });
  }
  return {
    voters: voters.map(function (v) { return v.name; }),
    weights: WEIGHTS,
    limits: { maxPerArtist: MAX_PER_ARTIST },
    rows: rows
  };
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try { return json_({ ok: true, data: readAll_() }); }
  catch (err) { return json_({ ok: false, error: String(err) }); }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var body = JSON.parse(e.postData.contents);
    return (body.action === 'admin') ? admin_(body) : vote_(body);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/** Save one person's votes. Only their own column is touched. */
function vote_(body) {
  var voter = String(body.voter || '').trim();
  if (!voter) throw new Error('No voter name supplied.');

  var sh = sheet_();
  var head = sh.getRange(HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0];
  var col = -1;
  for (var c = FIRST_COL - 1; c < LAST_COL; c++) {
    if (String(head[c] || '').trim().toLowerCase() === voter.toLowerCase()) { col = c + 1; break; }
  }
  if (col < 0) throw new Error('No column for "' + voter + '". Run setupSheet first.');

  var byKey = {};
  readAll_().rows.forEach(function (r) { byKey[r.song + '|' + r.artist] = r; });

  var votes = body.votes || {}, written = 0;
  Object.keys(votes).forEach(function (k) {
    var r = byKey[k];
    if (!r) return;
    if (/^LOCKED/i.test(r.section) && !/pick ONE/i.test(r.section)) return;
    var val = String(votes[k] || '').trim().toUpperCase();
    if (VOTE_VALUES.indexOf(val) < 0) return;
    sh.getRange(r.row, col).setValue(val);
    written++;
  });
  SpreadsheetApp.flush();
  return json_({ ok: true, voter: voter, written: written, data: readAll_() });
}

/**
 * Admin: add / update / remove songs.
 * Body: {action:'admin', key:'...',
 *        add:    [{section,song,artist,lead,length,energy,tags}],
 *        update: [{key:'Song|Artist', section,song,artist,lead,length,energy,tags}],
 *        remove: ['Song|Artist', ...]}
 */
function admin_(body) {
  if (String(body.key || '') !== ADMIN_KEY) throw new Error('Wrong admin key.');
  var sh = sheet_();
  var result = { added: 0, updated: 0, removed: 0 };

  // --- update in place
  (body.update || []).forEach(function (u) {
    var byKey = {};
    readAll_().rows.forEach(function (r) { byKey[r.song + '|' + r.artist] = r; });
    var r = byKey[u.key];
    if (!r) return;
    sh.getRange(r.row, 2, 1, 5).setValues([[
      u.section || r.section, u.song || r.song, u.artist || r.artist,
      String(u.lead || r.lead).toUpperCase(), u.length || r.len]]);
    sh.getRange(r.row, COL_ENERGY, 1, 2).setValues([[
      Number(u.energy) || r.energy || 3,
      Array.isArray(u.tags) ? u.tags.join(',') : (u.tags || r.tags.join(','))]]);
    result.updated++;
  });

  // --- remove (bottom-up so row numbers stay valid)
  var rm = (body.remove || []).slice();
  if (rm.length) {
    var targets = readAll_().rows
      .filter(function (r) { return rm.indexOf(r.song + '|' + r.artist) >= 0; })
      .sort(function (a, b) { return b.row - a.row; });
    targets.forEach(function (r) { sh.deleteRow(r.row); result.removed++; });
  }

  // --- add, grouped under the matching section where one exists
  (body.add || []).forEach(function (a) {
    if (!a.song || !a.artist) return;
    var state = readAll_();
    var dup = state.rows.filter(function (r) {
      return r.song === a.song && r.artist === a.artist; });
    if (dup.length) return;                        // never create a duplicate key

    var sameSection = state.rows.filter(function (r) { return r.section === a.section; });
    var at = sameSection.length
      ? sameSection[sameSection.length - 1].row
      : (state.rows.length ? state.rows[state.rows.length - 1].row : HEADER_ROW);
    sh.insertRowAfter(at);
    var row = at + 1;
    sh.getRange(row, 1, 1, 6).setValues([['', a.section || 'Added',
      a.song, a.artist, String(a.lead || 'V1').toUpperCase(), a.length || '3:30']]);
    sh.getRange(row, COL_ENERGY, 1, 2).setValues([[
      Number(a.energy) || 3, Array.isArray(a.tags) ? a.tags.join(',') : (a.tags || '')]]);
    result.added++;
  });

  // --- manual running order
  if (body.clearOrder) {
    var lastR = sh.getLastRow();
    if (lastR > HEADER_ROW) {
      sh.getRange(HEADER_ROW + 1, COL_ORDER, lastR - HEADER_ROW, 1).clearContent();
    }
    result.orderCleared = true;
  } else if (body.order && body.order.length) {
    var pos = {};
    body.order.forEach(function (o) { pos[o.key] = o.pos; });
    var lastR2 = sh.getLastRow();
    if (lastR2 > HEADER_ROW) {
      sh.getRange(HEADER_ROW + 1, COL_ORDER, lastR2 - HEADER_ROW, 1).clearContent();
    }
    readAll_().rows.forEach(function (r) {
      var k = r.song + '|' + r.artist;
      if (pos[k]) sh.getRange(r.row, COL_ORDER).setValue(pos[k]);
    });
    result.ordered = body.order.length;
  }

  renumber_();
  SpreadsheetApp.flush();
  return json_({ ok: true, result: result, data: readAll_() });
}

/** Keep the # column tidy: blank for locked rows, 1..n for the ballot. */
function renumber_() {
  var sh = sheet_();
  var state = readAll_();
  var n = 0;
  state.rows.forEach(function (r) {
    var isLocked = /^LOCKED/i.test(r.section);
    sh.getRange(r.row, 1).setValue(isLocked ? '' : ++n);
  });
}
