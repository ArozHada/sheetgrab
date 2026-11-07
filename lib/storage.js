// User configuration in chrome.storage.sync (follows the user across synced browsers).
//
// config = {
//   spreadsheetId, spreadsheetTitle, sheetUrl,
//   sheetTitle, sheetGid,
//   columns: [{ index, header, rule }],  // index = 0-based column position in the tab
//   wanted: ['company', 'url', ...]      // standard columns SheetGrab keeps in the Sheet
// }
// Rows are written by header name, so `index` is only used for display.

const KEY = 'config';

export async function loadConfig() {
  const res = await chrome.storage.sync.get(KEY);
  return res[KEY] || null;
}

export async function saveConfig(config) {
  await chrome.storage.sync.set({ [KEY]: config });
}

export function isConfigured(cfg) {
  return Boolean(cfg?.spreadsheetId && cfg.sheetTitle && cfg.columns?.length);
}

/** Pulls the spreadsheet ID out of a pasted Google Sheets URL (or accepts a bare ID). */
export function parseSpreadsheetId(input) {
  const s = String(input || '').trim();
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(s);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{25,}$/.test(s) ? s : null;
}

export function sheetLink(cfg, row) {
  const base = `https://docs.google.com/spreadsheets/d/${cfg.spreadsheetId}/edit`;
  const gid = cfg.sheetGid ?? 0;
  return row ? `${base}#gid=${gid}&range=A${row}` : `${base}#gid=${gid}`;
}

/** Column index -> letter (0 -> A, 26 -> AA). */
export function columnLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
