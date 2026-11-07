// Keyword-heuristic extraction engine.
//
// Pure module: no DOM and no chrome.* APIs. Input is the raw page snapshot
// produced by content/collect.js:
//   { url, title, text, selection, meta: { 'og:title': ['...'], ... }, jsonld: [ ...parsed blocks ] }
// It is unit-tested with `node --test`.

import { PRESETS } from './rules.js';

/** -> [{ ...column, value, source }] in column order. */
export function extractAll(columns, page, now = new Date()) {
  const ctx = buildContext(page, now);
  return columns.map((col) => ({ ...col, ...extractField(col.rule, ctx) }));
}

export function buildContext(page = {}, now = new Date()) {
  const toLines = (t) =>
    String(t || '')
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  // Text the user selected is searched first, so it wins ties.
  const lines = [...toLines(page.selection), ...toLines(page.text)];
  return { page, lines, nodes: flattenJsonLd(page.jsonld), meta: page.meta || {}, now };
}

/** -> { value, source } where source is a short human label or null. */
export function extractField(rule = { type: 'blank' }, ctx) {
  const empty = { value: '', source: null };
  if (!rule || rule.type === 'blank') return empty;

  if (rule.type === 'regex') {
    if (!rule.pattern) return empty;
    let re;
    try {
      re = new RegExp(rule.pattern, 'im');
    } catch {
      return { ...empty, error: 'Invalid regex' };
    }
    const m = re.exec(ctx.page.text || '');
    if (!m) return empty;
    return { value: clip(String(m[1] ?? m[0]).trim(), 500), source: 'page text' };
  }

  if (rule.type === 'keyword') {
    const value = keywordSearch(ctx.lines, rule.keywords || [], rule.valueKind || 'text');
    return value ? { value, source: 'page text' } : empty;
  }

  const preset = PRESETS[rule.type];
  if (!preset) return empty;
  for (const src of preset.sources) {
    const value = resolveSource(src, rule, preset, ctx);
    if (value) return { value, source: sourceLabel(src) };
  }
  return empty;
}

// ---------------------------------------------------------------------------
// Sources

function sourceLabel(src) {
  if (src === 'keywords') return 'page text';
  if (src.startsWith('jobposting.') || src.startsWith('article.')) return 'structured data';
  if (src.startsWith('meta.')) return 'page metadata';
  if (src.startsWith('title.')) return 'page title';
  if (src === 'url') return 'page URL';
  if (src === 'today') return 'today';
  return src;
}

function resolveSource(src, rule, preset, ctx) {
  const kind = preset.valueKind || 'text';
  const [ns, field] = splitOnce(src, '.');

  switch (ns) {
    case 'keywords': {
      const kws = rule.keywords?.length ? rule.keywords : preset.keywords || [];
      return keywordSearch(ctx.lines, kws, kind);
    }
    case 'jobposting':
      return fromJobPosting(findNode(ctx.nodes, ['JobPosting']), field);
    case 'article':
      return fromArticle(
        findNode(ctx.nodes, ['ScholarlyArticle', 'Article', 'NewsArticle', 'BlogPosting', 'Report', 'CreativeWork']),
        field
      );
    case 'meta': {
      const vals = (ctx.meta[field.toLowerCase()] || []).map(decodeEntities).filter(Boolean);
      if (!vals.length) return '';
      if (kind === 'date') return normalizeDate(vals[0]);
      // og:site_name on a job board is the board ("LinkedIn"), not the employer.
      if (field === 'og:site_name' && SITE_NAMES.test(vals[0])) return '';
      // Multi-valued tags (citation_author) are joined; names already contain commas.
      const joined = field === 'citation_author' ? vals.join('; ') : vals[0];
      return cleanByKind(joined, kind === 'name' ? 'name' : kind === 'longtext' ? 'longtext' : 'text');
    }
    case 'title': {
      const og = ctx.meta['og:title']?.[0];
      if (field === 'raw') return (ctx.page.title || og || '').trim();
      const parsed = parseTitle(og || ctx.page.title || '');
      if (field === 'role') return parsed.role || parseTitle(ctx.page.title || '').role;
      if (field === 'company') return parsed.company || parseTitle(ctx.page.title || '').company;
      return '';
    }
    case 'url':
      return cleanUrl(ctx.page.url);
    case 'today':
      return formatYMD(ctx.now);
    default:
      return '';
  }
}

// Query parameters that only track where a click came from. Everything else is kept.
const TRACKING_PARAM = /^(?:utm_.+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|igshid|gh_src|trk|trkinfo|refid|trackingid|eBP)$/i;

/** Removes tracking parameters so the saved link stays short and stable. */
export function cleanUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  let u;
  try {
    u = new URL(s);
  } catch {
    return s;
  }
  if (!/^https?:$/.test(u.protocol)) return s;
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
  }
  return u.toString();
}

function splitOnce(s, sep) {
  const i = s.indexOf(sep);
  return i === -1 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}

// ---------------------------------------------------------------------------
// Keyword search

const SEPARATOR_RE = /^\s*(?:[:：]+|[-–—]+(?=\s)|\bis\b|\bare\b|\bwill be\b)\s*/i;
// For prose-like kinds, require a "Label: value" or "Label" + next-line layout,
// otherwise "our company is a leader in..." would be extracted as a company.
const STRICT_KINDS = new Set(['name', 'text', 'longtext']);

export function keywordSearch(lines, keywords, kind = 'text') {
  let best = null;
  keywords.forEach((kw, k) => {
    const kwText = String(kw).trim();
    if (!kwText) return;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(kwText)}(?![\\p{L}\\p{N}])`, 'iu');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = re.exec(line);
      if (!m) continue;

      let rest = line.slice(m.index + m[0].length);
      const sep = SEPARATOR_RE.exec(rest);
      const hasColon = Boolean(sep && /[:：]/.test(sep[0]));
      rest = rest.slice(sep ? sep[0].length : 0).trim();
      const atStart = /^[\s•*·\-–—\d.)]*$/.test(line.slice(0, m.index));
      const labelOnly = !rest && atStart;

      if (STRICT_KINDS.has(kind) && !hasColon && !labelOnly) continue;

      let value = '';
      if (rest) value = cleanByKind(rest, kind);
      else if (labelOnly && i + 1 < lines.length) value = cleanByKind(lines[i + 1], kind);
      if (!value) continue;

      const score = (hasColon ? 3 : 0) + (labelOnly ? 3 : 0) + (atStart ? 2 : 0) - k * 0.01;
      if (!best || score > best.score) best = { score, value };
    }
  });
  return best ? best.value : '';
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Value cleaners

export function cleanByKind(raw, kind) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  switch (kind) {
    case 'date':
      return findDate(s);
    case 'person':
      return findPerson(s);
    case 'email':
      return findEmail(s);
    case 'name':
      return cleanName(s);
    case 'longtext':
      return clip(s, 2000);
    default:
      return cleanText(s);
  }
}

// Cut before an inline "Next Label:" ("Location: NYC Salary: $100k").
const NEXT_LABEL_RE = /\s(?=[A-Z][A-Za-z]+(?: [A-Za-z]+){0,2}:\s)/;

function cleanName(s) {
  let v = s.split(/\s+[|·•]\s+|\s+[-–—]\s+/)[0];
  v = v.split(NEXT_LABEL_RE)[0];
  v = v.replace(/^[\s"'“”‘’(]+|[\s"'“”‘’),;:.]+$/g, '').trim();
  // Anything this long is a sentence, not a name or title.
  if (!v || v.length > 80) return '';
  return v;
}

function cleanText(s) {
  let v = s.split(/\s+[|·•]\s+/)[0];
  v = v.split(NEXT_LABEL_RE)[0];
  const sentence = /^(.{10,}?[.!?])(?:\s|$)/.exec(v);
  if (sentence) v = sentence[1];
  return clip(v.trim(), 150);
}

function clip(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trim()}…`;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

function findEmail(s) {
  return EMAIL_RE.exec(s)?.[0] || '';
}

const NAME_WORD = "(?:[A-Z][a-zA-Z'’-]+|[A-Z]\\.)";
const NAME_RE = new RegExp(`(?<![A-Za-z])${NAME_WORD}(?:\\s+${NAME_WORD}){1,3}(?![A-Za-z])`);
const NOT_NAME = new Set(['us', 'me', 'our', 'the', 'information', 'info', 'details', 'form', 'page', 'here', 'please', 'apply', 'now', 'email', 'today']);

function findPerson(s) {
  const email = findEmail(s);
  const head = s.slice(0, 80).replace(EMAIL_RE, ' ');
  let name = '';
  const m = NAME_RE.exec(head);
  if (m) {
    const words = m[0].split(/\s+/).filter((w) => !/^(?:Mr|Mrs|Ms|Dr|Prof)\.?$/.test(w));
    if (words.length >= 2 && !words.some((w) => NOT_NAME.has(w.toLowerCase()))) name = words.join(' ');
  }
  if (name && email) return `${name} (${email})`;
  return name || email;
}

const MONTHS =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_PATTERNS = [
  /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/,
  new RegExp(`\\b${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, 'i'),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTHS}\\.?(?:,?\\s+\\d{4})?\\b`, 'i'),
  /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/,
  new RegExp(`\\b${MONTHS}\\.?\\s+\\d{4}\\b`, 'i'),
];

/** Earliest date-looking substring, lightly normalized. Returned as text for Sheets to parse. */
export function findDate(s) {
  let best = null;
  for (const re of DATE_PATTERNS) {
    const m = re.exec(s);
    if (m && (!best || m.index < best.index)) best = m;
  }
  if (!best) return '';
  if (/^\d{4}[/.]/.test(best[0])) return best[0].replace(/[/.]/g, '-'); // 2025/11/03 -> 2025-11-03
  return best[0]
    .replace(/(\d)(?:st|nd|rd|th)\b/i, '$1')
    .replace(/\s+of\s+/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "2026-03-31T23:59:00Z" -> "2026-03-31"; free text -> findDate. */
function normalizeDate(v) {
  const s = String(v || '').trim();
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(s);
  return iso ? iso[1] : findDate(s);
}

export function formatYMD(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// Page title parsing

const SITE_NAMES =
  /^(?:linkedin|indeed(?:\.com)?|glassdoor|greenhouse|lever|workday|myworkdayjobs|handshake|ziprecruiter|wellfound|angellist|monster|simplyhired|dice|builtin|built in|careers?|jobs?|job board|job details|home)$/i;

/** Guess role and company from titles like "Acme hiring Engineer in NYC | LinkedIn". */
export function parseTitle(title) {
  const parts = String(title || '')
    .split(/\s+[|–—·•]\s+|\s+-\s+/)
    .map((p) => p.trim())
    .filter((p) => p && !SITE_NAMES.test(p));
  if (!parts.length) return { role: '', company: '' };
  const first = parts[0];

  let m = /^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+.+)?$/i.exec(first);
  if (m) return { company: m[1].trim(), role: m[2].trim() };

  m = /^(?:job application for\s+)?(.+?)\s+at\s+(.+)$/i.exec(first);
  if (m && !/^careers?$|^jobs?$/i.test(m[1])) return { role: m[1].trim(), company: stripCareers(m[2]) };

  const role = /^(?:careers?|jobs?)(?:\s+at\s+.*)?$/i.test(first) ? '' : first.replace(/^job application for\s+/i, '');
  // "Role - Team | Company": the employer is usually the last remaining part.
  const company = parts.length > 1 ? stripCareers(parts[parts.length - 1]) : '';
  return { role, company };
}

function stripCareers(s) {
  return s.replace(/\s+(?:careers?|jobs?|job board)$/i, '').trim();
}

// ---------------------------------------------------------------------------
// JSON-LD helpers

export function flattenJsonLd(blocks) {
  const out = [];
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    if (n['@graph']) visit(n['@graph']);
    if (n['@type']) out.push(n);
  };
  visit(blocks || []);
  return out;
}

function findNode(nodes, types) {
  return nodes.find((n) => [].concat(n['@type']).some((t) => types.includes(t))) || null;
}

const asText = (v) => decodeEntities(typeof v === 'string' ? v : v?.name || '').trim();

function fromJobPosting(job, field) {
  if (!job) return '';
  switch (field) {
    case 'title':
      return cleanName(asText(job.title));
    case 'hiringOrganization':
      return cleanName(asText(job.hiringOrganization));
    case 'validThrough':
    case 'datePosted':
      return normalizeDate(job[field]);
    case 'jobLocation':
      return formatLocation(job);
    case 'baseSalary':
      return formatSalary(job.baseSalary);
    default:
      return '';
  }
}

function fromArticle(art, field) {
  if (!art) return '';
  if (field === 'author') {
    return []
      .concat(art.author || [])
      .map(asText)
      .filter(Boolean)
      .join('; ');
  }
  if (field === 'datePublished') return normalizeDate(art.datePublished);
  return '';
}

function formatLocation(job) {
  const places = [].concat(job.jobLocation || []).map((p) => {
    const a = p?.address;
    if (!a) return asText(p);
    if (typeof a === 'string') return a;
    return [a.addressLocality, a.addressRegion, asText(a.addressCountry)].filter(Boolean).join(', ');
  });
  if (/TELECOMMUTE/i.test(JSON.stringify(job.jobLocationType || ''))) places.push('Remote');
  return [...new Set(places.filter(Boolean))].join('; ');
}

function formatSalary(sal) {
  if (!sal || typeof sal !== 'object') return '';
  const cur = sal.currency || '';
  const v = sal.value;
  const unit = v?.unitText ? ` per ${String(v.unitText).toLowerCase()}` : '';
  const amount = (n) => Number(n).toLocaleString('en-US');
  if (v && typeof v === 'object') {
    if (v.minValue != null && v.maxValue != null) return `${amount(v.minValue)}–${amount(v.maxValue)} ${cur}${unit}`.trim();
    if (v.value != null) return `${amount(v.value)} ${cur}${unit}`.trim();
  }
  if (v != null && typeof v !== 'object') return `${amount(v)} ${cur}`.trim();
  return '';
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}
