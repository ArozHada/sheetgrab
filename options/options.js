import { loadConfig, saveConfig, parseSpreadsheetId, columnLetter } from '../lib/storage.js';
import {
  PRESETS,
  GENERIC_TYPES,
  VALUE_KINDS,
  STANDARD_HEADERS,
  DEFAULT_WANTED,
  autoMap,
  defaultRule,
  usesKeywords,
  planColumns,
} from '../lib/rules.js';
import { send } from '../lib/messaging.js';
import { h, setMsg } from '../lib/dom.js';

const $ = (id) => document.getElementById(id);

const state = {
  signedIn: false,
  spreadsheetId: null,
  spreadsheetTitle: '',
  sheetUrl: '',
  tabs: [],
  sheetTitle: '',
  sheetGid: 0,
  headerWidth: 0, // number of cells in row 1, including blank ones
  columns: [], // includes { pending: true } columns that will be created on save
  wanted: [...DEFAULT_WANTED],
};

/** Re-plans pending columns after anything that changes what's mapped. */
function replan() {
  state.columns = planColumns(state.columns, state.wanted, state.headerWidth);
}
let dirty = false;

// ---------------------------------------------------------------------------
// Account

async function refreshAuth() {
  try {
    state.signedIn = (await send('auth:status')).signedIn;
  } catch {
    state.signedIn = false;
  }
  $('authText').textContent = state.signedIn
    ? 'Connected. SheetGrab can read and append to Sheets you can edit.'
    : 'Not connected. SheetGrab needs permission to read headers and append rows to your Sheets.';
  $('connect').hidden = state.signedIn;
  $('disconnect').hidden = !state.signedIn;
}

$('connect').addEventListener('click', async () => {
  setMsg($('authMsg'));
  $('connect').disabled = true;
  try {
    await send('auth:signIn');
    await refreshAuth();
    if (state.spreadsheetId) await loadTabs({ keepSelection: true });
  } catch (err) {
    setMsg($('authMsg'), err.message, 'error');
  } finally {
    $('connect').disabled = false;
  }
});

$('disconnect').addEventListener('click', async () => {
  await send('auth:signOut').catch(() => {});
  await refreshAuth();
});

// ---------------------------------------------------------------------------
// Sheet + tab

$('load').addEventListener('click', () => loadTabs({ keepSelection: false }));
$('sheetUrl').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadTabs({ keepSelection: false });
});

async function loadTabs({ keepSelection }) {
  const url = $('sheetUrl').value.trim();
  const id = parseSpreadsheetId(url);
  if (!id) {
    setMsg($('sheetMsg'), 'That doesn’t look like a Google Sheets URL. It should contain /spreadsheets/d/…', 'error');
    return;
  }
  if (!state.signedIn) {
    setMsg($('sheetMsg'), 'Connect your Google account first (step 1).', 'warn');
    return;
  }
  setMsg($('sheetMsg'), 'Loading tabs…', 'info');
  $('load').disabled = true;
  try {
    const { title, tabs } = await send('sheets:tabs', { spreadsheetId: id });
    const changedSheet = id !== state.spreadsheetId;
    Object.assign(state, { spreadsheetId: id, spreadsheetTitle: title, sheetUrl: url, tabs });
    if (changedSheet) markDirty();

    const keep = (keepSelection || !changedSheet) && tabs.find((t) => t.title === state.sheetTitle);
    renderTabSelect(keep ? keep.title : tabs[0]?.title);
    setMsg($('sheetMsg'), `Loaded “${title}”.`, 'ok');
    if (!keep) await selectTab(tabs[0]?.title);
  } catch (err) {
    setMsg($('sheetMsg'), err.message, 'error');
  } finally {
    $('load').disabled = false;
  }
}

function renderTabSelect(selected) {
  const sel = $('tab');
  sel.replaceChildren(...state.tabs.map((t) => h('option', { value: t.title, selected: t.title === selected }, t.title)));
  sel.disabled = !state.tabs.length;
}

$('tab').addEventListener('change', (e) => selectTab(e.target.value));

async function selectTab(title) {
  if (!title) return;
  const tab = state.tabs.find((t) => t.title === title);
  if (title !== state.sheetTitle) markDirty();
  state.sheetTitle = title;
  state.sheetGid = tab?.sheetId ?? 0;
  await loadHeaders();
}

// ---------------------------------------------------------------------------
// Column mapping

$('refresh').addEventListener('click', loadHeaders);

async function loadHeaders() {
  if (!state.spreadsheetId || !state.sheetTitle) return;
  $('refresh').disabled = true;
  try {
    const headers = await send('sheets:headers', { spreadsheetId: state.spreadsheetId, tab: state.sheetTitle });
    state.headerWidth = headers.length;
    // Keep rules the user already set, matched by header name.
    const previous = new Map(state.columns.map((c) => [c.header.toLowerCase(), c.rule]));
    const real = headers
      .map((header, index) => ({ index, header }))
      .filter((c) => c.header)
      .map((c) => ({ ...c, rule: previous.get(c.header.toLowerCase()) || autoMap(c.header) }));
    const columns = planColumns(
      [...real, ...state.columns.filter((c) => c.pending)],
      state.wanted,
      state.headerWidth
    );

    if (!real.length) {
      setMsg(
        $('sheetMsg'),
        columns.length
          ? `Row 1 of “${state.sheetTitle}” is empty. SheetGrab will create the columns below when you click Save settings.`
          : `Row 1 of “${state.sheetTitle}” is empty. Pick some standard columns below, or type headers into row 1 and click Refresh headers.`,
        'info'
      );
    }
    const changed = JSON.stringify(columns) !== JSON.stringify(state.columns);
    state.columns = columns;
    if (changed) markDirty();
    renderRows();
  } catch (err) {
    setMsg($('sheetMsg'), err.message, 'error');
  } finally {
    $('refresh').disabled = !state.sheetTitle;
  }
}

function ruleSelect(col) {
  const opt = (type, label) => h('option', { value: type, selected: col.rule.type === type }, label);
  return h(
    'select',
    {
      'aria-label': `Rule for ${col.header}`,
      // A new column's rule comes from its checkbox; untick it to drop the column.
      disabled: Boolean(col.pending),
      onchange: (e) => {
        col.rule = defaultRule(e.target.value);
        replan();
        markDirty();
        renderRows();
      },
    },
    h('optgroup', { label: 'Smart fields' }, Object.entries(PRESETS).map(([t, p]) => opt(t, p.label))),
    h('optgroup', { label: 'Other' }, Object.entries(GENERIC_TYPES).map(([t, g]) => opt(t, g.label)))
  );
}

function detailsCell(col) {
  const { rule } = col;
  const box = h('div', { class: 'details' });

  if (usesKeywords(rule.type)) {
    box.append(
      h('input', {
        type: 'text',
        value: (rule.keywords || []).join(', '),
        placeholder: 'Comma-separated labels, e.g. Deadline, Apply by',
        'aria-label': `Keywords for ${col.header}`,
        oninput: (e) => {
          rule.keywords = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
          markDirty();
        },
      })
    );
  }
  if (rule.type === 'keyword') {
    box.append(
      h(
        'label',
        { class: 'sub' },
        'Value looks like',
        h(
          'select',
          {
            onchange: (e) => {
              rule.valueKind = e.target.value;
              markDirty();
            },
          },
          Object.entries(VALUE_KINDS).map(([k, label]) => h('option', { value: k, selected: rule.valueKind === k }, label))
        )
      )
    );
  }
  if (rule.type === 'regex') {
    const input = h('input', {
      type: 'text',
      value: rule.pattern || '',
      spellcheck: 'false',
      placeholder: 'e.g. Req(?:uisition)? ID:?\\s*(\\S+)',
      'aria-label': `Regex for ${col.header}`,
      oninput: (e) => {
        rule.pattern = e.target.value;
        e.target.classList.toggle('invalid', !isValidRegex(rule.pattern));
        markDirty();
      },
    });
    input.classList.toggle('invalid', !isValidRegex(rule.pattern || ''));
    box.append(input, h('span', { class: 'muted note' }, 'Uses the first capture group, or the whole match. Case-insensitive.'));
  }

  const notes = {
    url: 'Fills in the page’s URL.',
    dateSaved: 'Fills in today’s date (YYYY-MM-DD).',
    pageTitle: 'Fills in the page’s <title>.',
    blank: 'Left empty. You can type a value in the popup.',
  };
  if (notes[rule.type]) box.append(h('span', { class: 'muted note' }, notes[rule.type]));
  if (col.pending) {
    box.append(h('span', { class: 'muted note' }, `New column: “${col.header}” is added to row 1 of your Sheet when you save.`));
  }

  const fallbacks = PRESETS[rule.type]?.sources.filter((s) => s !== 'keywords');
  if (usesKeywords(rule.type) && fallbacks?.length) {
    box.append(h('span', { class: 'muted note' }, `Also checks: ${fallbacks.map(describeSource).join(', ')}.`));
  }
  return box;
}

function describeSource(src) {
  if (src.startsWith('jobposting.') || src.startsWith('article.')) return 'structured job/article data';
  if (src.startsWith('meta.')) return `<meta ${src.slice(5)}>`;
  if (src.startsWith('title.')) return 'page title';
  return src;
}

function renderWanted() {
  $('wanted').replaceChildren(
    ...Object.entries(STANDARD_HEADERS).map(([type, header]) =>
      h(
        'label',
        { class: 'chip' },
        h('input', {
          type: 'checkbox',
          checked: state.wanted.includes(type),
          onchange: (e) => {
            state.wanted = e.target.checked ? [...state.wanted, type] : state.wanted.filter((t) => t !== type);
            replan();
            markDirty();
            renderRows();
          },
        }),
        header
      )
    )
  );
}

function renderRows() {
  renderWanted();
  const tbody = $('rows');
  if (!state.columns.length) {
    tbody.replaceChildren(h('tr', {}, h('td', { colspan: 3, class: 'muted empty-row' }, 'No columns yet.')));
    return;
  }
  tbody.replaceChildren(
    ...state.columns.map((col) =>
      h(
        'tr',
        {},
        h(
          'td',
          { class: 'colname' },
          h('span', { class: 'letter' }, columnLetter(col.index)),
          col.header,
          col.pending && h('span', { class: 'badge-new', title: 'Will be added to row 1 when you save' }, 'new')
        ),
        h('td', {}, ruleSelect(col)),
        h('td', {}, detailsCell(col))
      )
    )
  );
}

function isValidRegex(p) {
  try {
    new RegExp(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Save

function markDirty() {
  dirty = true;
  setMsg($('saveMsg'), 'You have unsaved changes.', 'warn');
}

$('save').addEventListener('click', async () => {
  if (!state.spreadsheetId || !state.sheetTitle) {
    setMsg($('saveMsg'), 'Load a Sheet and pick a tab first.', 'error');
    return;
  }
  if (!state.columns.length) {
    setMsg($('saveMsg'), 'This tab has no column headers yet.', 'error');
    return;
  }
  const badRegex = state.columns.find((c) => c.rule.type === 'regex' && !isValidRegex(c.rule.pattern || ''));
  if (badRegex) {
    setMsg($('saveMsg'), `The regex for “${badRegex.header}” isn’t valid.`, 'error');
    return;
  }
  $('save').disabled = true;
  try {
    // 1. Create any missing standard columns in row 1 and link them to their rules.
    let createdNote = '';
    const pending = state.columns.filter((c) => c.pending);
    if (pending.length) {
      setMsg($('saveMsg'), 'Adding columns to your Sheet…', 'info');
      const { columns: placed, created } = await send('sheets:addHeaders', {
        spreadsheetId: state.spreadsheetId,
        tab: state.sheetTitle,
        headers: pending.map((c) => c.header),
      });
      // The background re-reads row 1, so positions are correct even if the Sheet changed meanwhile.
      pending.forEach((col, i) => {
        col.index = placed[i].index;
        delete col.pending;
      });
      state.headerWidth = Math.max(state.headerWidth, ...placed.map((p) => p.index + 1));
      state.columns.sort((a, b) => a.index - b.index);
      if (created.length) {
        createdNote = ` Added ${created.map((c) => `“${c.header}” (column ${c.column})`).join(', ')} to your Sheet.`;
      }
      renderRows();
    }

    // 2. Save the mapping.
    await saveConfig({
      spreadsheetId: state.spreadsheetId,
      spreadsheetTitle: state.spreadsheetTitle,
      sheetUrl: state.sheetUrl,
      sheetTitle: state.sheetTitle,
      sheetGid: state.sheetGid,
      columns: state.columns,
      wanted: state.wanted,
    });
    dirty = false;
    setMsg($('saveMsg'), `Saved.${createdNote} Open any job posting and click the SheetGrab icon.`, 'ok');
  } catch (err) {
    setMsg($('saveMsg'), `Couldn’t save settings: ${err.message}`, 'error');
  } finally {
    $('save').disabled = false;
  }
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

// ---------------------------------------------------------------------------
// Init

(async function init() {
  const cfg = await loadConfig();
  if (cfg) {
    Object.assign(state, {
      spreadsheetId: cfg.spreadsheetId,
      spreadsheetTitle: cfg.spreadsheetTitle || '',
      sheetUrl: cfg.sheetUrl || '',
      sheetTitle: cfg.sheetTitle || '',
      sheetGid: cfg.sheetGid ?? 0,
      columns: cfg.columns || [],
      wanted: cfg.wanted || [...DEFAULT_WANTED],
    });
    $('sheetUrl').value = state.sheetUrl;
    if (state.sheetTitle) {
      state.tabs = [{ title: state.sheetTitle, sheetId: state.sheetGid }];
      renderTabSelect(state.sheetTitle);
      // Configs saved before standard columns existed may be missing some.
      replan();
      if (state.columns.some((c) => c.pending)) markDirty();
    }
  }
  renderRows();
  $('refresh').disabled = !state.sheetTitle;

  await refreshAuth();
  // Refresh the tab list in the background so the dropdown is complete.
  if (state.signedIn && state.spreadsheetId) {
    try {
      const { title, tabs } = await send('sheets:tabs', { spreadsheetId: state.spreadsheetId });
      Object.assign(state, { spreadsheetTitle: title, tabs });
      if (tabs.some((t) => t.title === state.sheetTitle)) {
        renderTabSelect(state.sheetTitle);
      } else {
        setMsg($('sheetMsg'), `The tab “${state.sheetTitle}” no longer exists. Check the tab below and save again.`, 'warn');
        renderTabSelect(tabs[0]?.title);
        await selectTab(tabs[0]?.title);
      }
    } catch (err) {
      setMsg($('sheetMsg'), err.message, 'error');
    }
  }
})();
