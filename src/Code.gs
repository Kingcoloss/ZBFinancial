/**
 * ZBFinancial: family income and expense tracker on Google Apps Script + Google Sheets.
 *
 * Callable from outside: doGet (web app), api (the browser), setup (run once from the editor).
 * Everything else lives in namespace objects (Db, Api, Items, ...), which google.script.run cannot reach.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('ZBFinancial')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Template helper: <?!= include_('Styles') ?>. The trailing underscore keeps it private. */
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function api(action, payload) {
  return Api.handle(action, payload);
}

/**
 * Run once from the Apps Script editor (Run > setup). Builds the Google Sheet workbook with every
 * tab and header, remembers it, and registers the person running it as the first admin.
 * Safe to run again: it only adds what is missing.
 */
function setup() {
  Db.reset();
  var ss = Db.ensureAll();
  var created = Db.createdWorkbook_;

  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
  } catch (e) {
    email = '';
  }
  email = email.toLowerCase();

  var registered = false;
  if (email) {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty('OWNER_EMAIL')) props.setProperty('OWNER_EMAIL', email);
    Db.withLock(function () {
      if (Db.table('Users').count(function () { return true; }) === 0) {
        Auth.registerFirst(email);
        registered = true;
      }
    });
  }

  var summary = { url: ss.getUrl(), spreadsheetId: ss.getId(), tabs: Db.TABLES, workbookCreated: created, adminRegistered: registered ? email : null };
  console.log('ZBFinancial setup: ' + JSON.stringify(summary));
  return summary;
}
