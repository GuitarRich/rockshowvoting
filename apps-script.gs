/**
 * Setlist vote backend — Google Apps Script.
 *
 * SETUP (once, ~3 minutes)
 *  1. Open the vote Google Sheet.
 *  2. Extensions -> Apps Script. Delete whatever is in Code.gs and paste this file in.
 *  3. Run  setupHeaders   once (Run menu). Approve the permission prompt.
 *     That fixes the voter column names and colour-codes the sheet.
 *  4. Deploy -> New deployment -> gear icon -> Web app.
 *        Description:      setlist vote
 *        Execute as:       Me
 *        Who has access:   Anyone            <-- important, voters have no Google login
 *     Deploy, approve, copy the /exec URL.
 *  5. Paste that URL into config.js in the repo, commit and push.
 *
 * After any edit to this file you must Deploy -> Manage deployments -> edit ->
 * Version: New version -> Deploy, or the live site keeps running the old code.
 */

var HEADER_ROW = 3;
var FIRST_COL  = 7;    // G
var LAST_COL   = 13;   // M
var VOTERS     = ['Rich', 'Ashley', 'CJ', 'Justin', 'Isaac', 'Julie', 'Organiser'];

function sheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}

/** Run this once from the editor. Writes the voter names and tidies the sheet. */
function setupHeaders() {
  var sh = sheet_();
  sh.getRange(HEADER_ROW, FIRST_COL, 1, VOTERS.length).setValues([VOTERS]);
  sh.getRange(HEADER_ROW, 1, 1, LAST_COL + 2)
    .setFontWeight('bold').setBackground('#1d2029').setFontColor('#e9eaf0');
  sh.setFrozenRows(HEADER_ROW);

  var last = sh.getLastRow();
  if (last > HEADER_ROW) {
    var body = sh.getRange(HEADER_ROW + 1, FIRST_COL, last - HEADER_ROW, VOTERS.length);
    var rules = [
      ['MUST', '#e8a33d', '#231a09'],
      ['YES',  '#d6f0e0', '#14532d'],
      ['NO',   '#f8d7d7', '#7f1d1d'],
      ['X',    '#ddd6fe', '#2e1065']
    ].map(function (r) {
      return SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(r[0]).setBackground(r[1]).setFontColor(r[2])
        .setRanges([body]).build();
    });
    sh.setConditionalFormatRules(rules);
    sh.getRange(HEADER_ROW + 1, 1, last - HEADER_ROW, LAST_COL + 2)
      .setVerticalAlignment('middle');
  }
  return 'Headers set: ' + VOTERS.join(', ');
}

function readAll_() {
  var sh = sheet_();
  var last = sh.getLastRow(), lastCol = sh.getLastColumn();
  var head = sh.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
  var idx = {};
  head.forEach(function (h, i) { idx[String(h).trim().toLowerCase()] = i; });

  var voters = [];
  for (var c = FIRST_COL - 1; c < LAST_COL; c++) {
    var name = String(head[c] || '').trim();
    if (name) voters.push({ name: name, col: c });
  }

  var vals = sh.getRange(HEADER_ROW + 1, 1, last - HEADER_ROW, lastCol).getValues();
  var rows = [];
  vals.forEach(function (r, i) {
    var song = String(r[idx['song']] || '').trim();
    if (!song) return;
    var votes = {};
    voters.forEach(function (v) { votes[v.name] = String(r[v.col] || '').trim().toUpperCase(); });
    rows.push({
      row:     HEADER_ROW + 1 + i,
      section: String(r[idx['section']] || '').trim(),
      song:    song,
      artist:  String(r[idx['artist']] || '').trim(),
      lead:    String(r[idx['lead']]   || '').trim().toUpperCase(),
      len:     String(r[idx['length']] || '').trim(),
      votes:   votes
    });
  });
  return { voters: voters.map(function (v) { return v.name; }), rows: rows };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** GET -> current state of the whole ballot. */
function doGet(e) {
  try {
    return json_({ ok: true, data: readAll_() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/**
 * POST -> save one person's votes.
 * Body: {"voter":"Ashley","votes":{"Barracuda|Heart":"MUST", ...}}
 * Blank string clears a cell. Only that voter's column is touched.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var body = JSON.parse(e.postData.contents);
    var voter = String(body.voter || '').trim();
    if (!voter) throw new Error('No voter name supplied.');

    var sh = sheet_();
    var head = sh.getRange(HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0];
    var col = -1;
    for (var c = FIRST_COL - 1; c < LAST_COL; c++) {
      if (String(head[c] || '').trim().toLowerCase() === voter.toLowerCase()) { col = c + 1; break; }
    }
    if (col < 0) throw new Error('No column found for "' + voter + '". Run setupHeaders first.');

    var state = readAll_();
    var byKey = {};
    state.rows.forEach(function (r) { byKey[r.song + '|' + r.artist] = r; });

    var votes = body.votes || {};
    var written = 0;
    Object.keys(votes).forEach(function (k) {
      var r = byKey[k];
      if (!r) return;
      if (/^LOCKED/i.test(r.section) && !/pick ONE/i.test(r.section)) return; // never overwrite locked
      var val = String(votes[k] || '').trim().toUpperCase();
      if (['MUST', 'YES', 'NO', 'X', ''].indexOf(val) < 0) return;
      sh.getRange(r.row, col).setValue(val);
      written++;
    });

    SpreadsheetApp.flush();
    return json_({ ok: true, voter: voter, written: written, data: readAll_() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}
