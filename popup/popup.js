import { loadConfig, isConfigured, sheetLink } from '../lib/storage.js';
import { extractAll } from '../lib/extract.js';
import { PRESETS } from '../lib/rules.js';
import { collectPageData } from '../content/collect.js';
import { send } from '../lib/messaging.js';
import { h, setMsg } from '../lib/dom.js';

const $ = (id) => document.getElementById(id);
let config = null;

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('openSetup').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('cancel').addEventListener('click', () => window.close());
$('close').addEventListener('click', () => window.close());
$('form').addEventListener('submit', onSave);

init().catch((err) => {
  $('loading').hidden = true;
  setMsg($('status'), err.message, 'error');
});

async function init() {
  config = await loadConfig();
  if (!isConfigured(config)) {
    $('loading').hidden = true;
    $('setup').hidden = false;
    return;
  }
  $('target').textContent = `${config.spreadsheetTitle || 'Sheet'} › ${config.sheetTitle}`;

  const [{ page, limited }, auth] = await Promise.all([collectPage(), send('auth:status').catch(() => null)]);
  const fields = extractAll(config.columns, page);

  renderFields(fields);
  $('loading').hidden = true;
  $('form').hidden = false;

  if (auth && !auth.signedIn) {
    showStatusWithSettings('Your Google account isn’t connected, so saving won’t work yet.', 'warn');
  } else if (limited) {
    setMsg($('status'), 'Chrome doesn’t let extensions read this page. Only the URL and title were filled in.', 'warn');
  } else if (!config.columns.some((c) => c.rule?.type === 'url')) {
    showStatusWithSettings('This page’s link won’t be saved: no column is set to Page URL.', 'info');
  }
  // Put the cursor in the first empty field the user is likely to fill in.
  const firstMissing = document.querySelector('.field.missing input, .field.missing textarea');
  (firstMissing || document.querySelector('.field input, .field textarea'))?.focus();
}

/** Runs the collector in the active tab. Falls back to tab metadata on restricted pages. */
async function collectPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const fallback = { url: tab?.url || '', title: tab?.title || '', text: '', selection: '', meta: {}, jsonld: [] };
  if (!tab?.id) return { page: fallback, limited: true };
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageData });
    return res?.result ? { page: res.result, limited: false } : { page: fallback, limited: true };
  } catch {
    // chrome://, the Web Store, PDF viewer, etc.
    return { page: fallback, limited: true };
  }
}

function renderFields(fields) {
  const container = $('fields');
  container.replaceChildren();
  for (const f of fields) {
    const id = `f${f.index}`;
    const preset = PRESETS[f.rule?.type];
    const isManual = !f.rule || f.rule.type === 'blank';
    const long = preset?.valueKind === 'longtext' || (f.value && f.value.length > 70);

    const hint = isManual ? 'fill in manually' : f.value ? `from ${f.source}` : f.error ? f.error : 'not found';
    const input = long
      ? h('textarea', { id, name: id, rows: preset?.valueKind === 'longtext' ? 4 : 2 })
      : h('input', { id, name: id, type: 'text', autocomplete: 'off' });
    input.value = f.value || '';
    input.dataset.index = f.index;
    if (long) {
      // Cmd/Ctrl+Enter saves from a textarea.
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('form').requestSubmit();
      });
    }

    container.append(
      h(
        'div',
        { class: `field${!f.value && !isManual ? ' missing' : ''}` },
        h('label', { for: id }, f.header, h('span', { class: 'hint' }, hint)),
        input
      )
    );
  }
}

async function onSave(e) {
  e.preventDefault();
  const saveBtn = $('save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  setMsg($('status'));

  const values = {};
  for (const el of $('fields').querySelectorAll('[data-index]')) values[el.dataset.index] = el.value.trim();

  try {
    const { row, created } = await send('sheets:appendByHeader', {
      spreadsheetId: config.spreadsheetId,
      tab: config.sheetTitle,
      entries: config.columns.map((c) => ({ header: c.header, value: values[c.index] ?? '' })),
    });
    $('form').hidden = true;
    $('status').hidden = true;
    $('success').hidden = false;
    $('successText').textContent = row ? `Added to Row ${row}` : 'Added to your Sheet';
    const where = `${config.spreadsheetTitle || 'Sheet'} › ${config.sheetTitle}`;
    const madeCols = created?.length
      ? ` · Created missing column${created.length > 1 ? 's' : ''} ${created.map((c) => `“${c.header}” (${c.column})`).join(', ')}`
      : '';
    $('successSub').textContent = where + madeCols;
    $('openSheet').onclick = () => chrome.tabs.create({ url: sheetLink(config, row) });
    $('close').focus();
  } catch (err) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save to Sheet';
    if (err.code === 'AUTH' || err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN') {
      showStatusWithSettings(err.message, 'error');
    } else {
      setMsg($('status'), err.message, 'error');
    }
  }
}

function showStatusWithSettings(text, tone) {
  const el = $('status');
  setMsg(el, text, tone);
  el.append(
    h('button', { type: 'button', class: 'link status-actions', onclick: () => chrome.runtime.openOptionsPage() }, 'Open Settings')
  );
}
