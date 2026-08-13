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
var MAX_ROW    = 300;  // formula range ceiling — room to grow
var VOTERS     = ['Rich', 'Ashley', 'CJ', 'Justin', 'Isaac', 'Julie', 'Organiser'];

// Single source of truth for scoring. The sheet formula and both web pages
// are built from this, so changing a number here changes everything.
// Scale is deliberately doubled from the original MUST 3 / YES 1 / NO -2 so
// that votes cast before MAYBE existed keep their exact relative weight.
var WEIGHTS = { MUST: 6, YES: 2, MAYBE: 1, NO: -4 };
var VOTE_VALUES = ['MUST', 'YES', 'MAYBE', 'NO', 'X', ''];

function sheet_() { return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]; }

/** Run once from the editor. Safe to re-run at any time. */
function setupSheet() {
  var sh = sheet_();
  sh.getRange(HEADER_ROW, FIRST_COL, 1, VOTERS.length).setValues([VOTERS]);
  sh.getRange(HEADER_ROW, COL_SCORE, 1, 4)
    .setValues([['SCORE', 'MUSTs', 'Energy', 'Tags']]);
  sh.getRange(HEADER_ROW, 1, 1, COL_TAGS)
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

function idx_(head) {
  var m = {};
  head.forEach(function (h, i) { m[String(h).trim().toLowerCase()] = i; });
  return m;
}

function readAll_() {
  var sh = sheet_();
  var last = sh.getLastRow(), lastCol = Math.max(sh.getLastColumn(), COL_TAGS);
  var head = sh.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
  var ix = idx_(head);

  var voters = [];
  for (var c = FIRST_COL - 1; c < LAST_COL; c++) {
    var name = String(head[c] || '').trim();
    if (name) voters.push({ name: name, col: c });
  }

  var rows = [];
  if (last > HEADER_ROW) {
    var vals = sh.getRange(HEADER_ROW + 1, 1, last - HEADER_ROW, lastCol).getValues();
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
        energy:  Number(r[COL_ENERGY - 1]) || 0,
        tags:    tags ? tags.split(/[,;]\s*/).filter(String) : [],
        votes:   votes
      });
    });
  }
  return { voters: voters.map(function (v) { return v.name; }), weights: WEIGHTS, rows: rows };
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
