// Thin Google Sheets API v4 client. Runs in the service worker.
import { authedFetch } from './auth.js';
import { columnLetter } from '../lib/storage.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetsError extends Error {
  constructor(message, code = 'SHEETS') {
    super(message);
    this.code = code;
  }
}

/** A1 range for a whole tab, quoted so names with spaces or apostrophes work. */
export function quoteTab(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

async function call(path, init) {
  const res = await authedFetch(`${API}/${path}`, init);
  if (res.ok) return res.json();

  let detail = '';
  try {
    detail = (await res.json())?.error?.message || '';
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 404) throw new SheetsError('Spreadsheet not found. Check the Sheet URL in Settings.', 'NOT_FOUND');
  if (res.status === 403) {
    throw new SheetsError(
      `Google denied access to this spreadsheet${detail ? `: ${detail}` : ''}. Make sure your account can edit it.`,
      'FORBIDDEN'
    );
  }
  if (res.status === 400 && /Unable to parse range/i.test(detail)) {
    throw new SheetsError('That tab no longer exists. Pick a tab again in Settings.', 'NOT_FOUND');
  }
  throw new SheetsError(`Google Sheets error ${res.status}${detail ? `: ${detail}` : ''}`);
}

const json = (body, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** -> { title, tabs: [{ title, sheetId }] } */
export async function getTabs(spreadsheetId) {
  const fields = encodeURIComponent('properties.title,sheets.properties(title,sheetId)');
  const data = await call(`${encodeURIComponent(spreadsheetId)}?fields=${fields}`);
  return {
    title: data.properties?.title || '',
    tabs: (data.sheets || []).map((s) => ({ title: s.properties.title, sheetId: s.properties.sheetId })),
  };
}

/** -> array of header strings from row 1 (may contain '' for blank columns). */
export async function getHeaders(spreadsheetId, tab) {
  const range = encodeURIComponent(`${quoteTab(tab)}!1:1`);
  const data = await call(`${encodeURIComponent(spreadsheetId)}/values/${range}?majorDimension=ROWS`);
  return (data.values?.[0] || []).map((h) => String(h).trim());
}

// ---------------------------------------------------------------------------
// Creating missing columns

const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Pure planner: finds each wanted header in row 1 (case-insensitive) and
 * places any missing ones after the last existing header.
 * -> { headers: new row 1, positions: index per name, created: indexes of new headers }
 */
export function planHeaderWrites(current, names) {
  const headers = [...current];
  const created = [];
  const positions = names.map((name) => {
    let i = headers.findIndex((h) => norm(h) && norm(h) === norm(name));
    if (i === -1) {
      i = headers.length;
      headers.push(String(name).trim());
      created.push(i);
    }
    return i;
  });
  return { headers, positions, created };
}

/** Grows the tab's grid if it has fewer than `needed` columns (new writes past the grid fail). */
async function ensureColumnCount(spreadsheetId, tab, needed) {
  const fields = encodeURIComponent('sheets.properties(sheetId,title,gridProperties.columnCount)');
  const data = await call(`${encodeURIComponent(spreadsheetId)}?fields=${fields}`);
  const sheet = (data.sheets || []).find((s) => s.properties.title === tab);
  if (!sheet) throw new SheetsError('That tab no longer exists. Pick a tab again in Settings.', 'NOT_FOUND');
  const have = sheet.properties.gridProperties?.columnCount ?? 0;
  if (have >= needed) return;
  await call(
    `${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    json({ requests: [{ appendDimension: { sheetId: sheet.properties.sheetId, dimension: 'COLUMNS', length: needed - have } }] })
  );
}

/** Writes the newly created header cells (they're always contiguous at the end of row 1). */
async function writeNewHeaders(spreadsheetId, tab, headers, created) {
  if (!created.length) return;
  const first = Math.min(...created);
  const last = Math.max(...created);
  await ensureColumnCount(spreadsheetId, tab, last + 1);
  const range = encodeURIComponent(`${quoteTab(tab)}!${columnLetter(first)}1:${columnLetter(last)}1`);
  await call(
    `${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=RAW`,
    json({ values: [headers.slice(first, last + 1)] }, 'PUT')
  );
}

const describeCreated = (headers, created) =>
  created.map((i) => ({ index: i, column: columnLetter(i), header: headers[i] }));

/**
 * Makes sure each header exists in row 1, creating missing ones.
 * -> { columns: [{ header, index }], created: [{ header, index, column }] }
 */
export async function addHeaders(spreadsheetId, tab, names) {
  const current = await getHeaders(spreadsheetId, tab);
  const { headers, positions, created } = planHeaderWrites(current, names);
  await writeNewHeaders(spreadsheetId, tab, headers, created);
  return {
    columns: names.map((header, i) => ({ header, index: positions[i] })),
    created: describeCreated(headers, created),
  };
}

// ---------------------------------------------------------------------------
// Appending rows

/**
 * Page text is untrusted: a value like "=IMPORTXML(...)" would become a live
 * formula under USER_ENTERED. Prefix such values with an apostrophe so Sheets
 * stores them as text. Plain numbers like "-5" or "+1" are left alone.
 */
export function neutralizeFormula(value) {
  const v = String(value ?? '');
  if (/^[=+\-@]/.test(v) && !/^[-+]?\d[\d,.]*$/.test(v)) return `'${v}`;
  return v;
}

/**
 * Appends one row, placing each value under the column whose header matches
 * (so reordered columns still line up). A column that's missing from the
 * Sheet is created first, but only when there's a value to put in it.
 * entries: [{ header, value }]  ->  { row: 42, updatedRange, created: [...] }
 */
export async function appendByHeader(spreadsheetId, tab, entries) {
  const withValue = entries.filter((e) => String(e.value ?? '').trim() !== '');
  if (!withValue.length) throw new SheetsError('Nothing to save: every field is empty.', 'EMPTY');

  const current = await getHeaders(spreadsheetId, tab);
  const { headers, positions, created } = planHeaderWrites(current, withValue.map((e) => e.header));
  await writeNewHeaders(spreadsheetId, tab, headers, created);

  const row = new Array(headers.length).fill('');
  withValue.forEach((e, i) => {
    row[positions[i]] = neutralizeFormula(String(e.value).trim());
  });

  const range = encodeURIComponent(`${quoteTab(tab)}!A1`);
  const qs = 'valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';
  const data = await call(
    `${encodeURIComponent(spreadsheetId)}/values/${range}:append?${qs}`,
    json({ majorDimension: 'ROWS', values: [row] })
  );
  const updatedRange = data.updates?.updatedRange || '';
  return { row: parseRowNumber(updatedRange), updatedRange, created: describeCreated(headers, created) };
}

/** "'My Tab'!A42:F42" -> 42 */
export function parseRowNumber(updatedRange) {
  const m = /![A-Z]+(\d+)/.exec(updatedRange);
  return m ? Number(m[1]) : null;
}
