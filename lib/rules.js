// Extraction rule presets and header auto-mapping.
//
// A stored rule looks like:
//   { type: 'deadline', keywords: ['Deadline', 'Apply by'] }   preset (keywords optional; override defaults)
//   { type: 'keyword', keywords: ['Visa'], valueKind: 'text' } custom keyword rule
//   { type: 'regex', pattern: 'Req(?:uisition)? ID:?\\s*(\\S+)' }
//   { type: 'blank' }
//
// `sources` is the ordered list of places to look; the first non-empty value wins.
// Source names are resolved in lib/extract.js.

export const PRESETS = {
  jobTitle: {
    label: 'Job title',
    valueKind: 'name',
    keywords: ['Job Title', 'Position', 'Role', 'Job'],
    sources: ['jobposting.title', 'keywords', 'title.role'],
    synonyms: ['job title', 'title', 'role', 'position', 'job', 'job name', 'opening', 'internship'],
  },
  company: {
    label: 'Company',
    valueKind: 'name',
    keywords: ['Company', 'Organization', 'Organisation', 'Employer', 'Company Name', 'Hiring Company'],
    sources: ['keywords', 'jobposting.hiringOrganization', 'title.company', 'meta.og:site_name'],
    synonyms: ['company', 'organization', 'organisation', 'org', 'employer', 'firm', 'institution', 'lab', 'company name'],
  },
  deadline: {
    label: 'Deadline',
    valueKind: 'date',
    keywords: [
      'Application Deadline', 'Deadline', 'Apply by', 'Apply before', 'Closes on', 'Closing on', 'Closing date',
      'Closes', 'Application due', 'Applications due', 'Due date', 'Due by', 'Accepting applications until',
      'Applications close', 'Valid through',
    ],
    sources: ['keywords', 'jobposting.validThrough'],
    synonyms: ['deadline', 'apply by', 'due', 'due date', 'closing date', 'closes', 'application deadline', 'close date'],
  },
  contact: {
    label: 'Contact person',
    valueKind: 'person',
    keywords: [
      'Hiring Manager', 'Recruiter', 'Point of Contact', 'Contact Person', 'Contact', 'Reach out to',
      'Questions? Contact', 'Send your resume to', 'Email',
    ],
    sources: ['keywords'],
    synonyms: ['contact', 'contact person', 'recruiter', 'hiring manager', 'poc', 'point of contact', 'reach out', 'email'],
  },
  location: {
    label: 'Location',
    valueKind: 'name',
    keywords: ['Location', 'Job Location', 'Office', 'Based in', 'Work Location'],
    sources: ['keywords', 'jobposting.jobLocation'],
    synonyms: ['location', 'city', 'office', 'where', 'place'],
  },
  salary: {
    label: 'Salary / pay',
    valueKind: 'text',
    keywords: ['Salary', 'Compensation', 'Pay Range', 'Pay', 'Stipend', 'Base Pay'],
    sources: ['keywords', 'jobposting.baseSalary'],
    synonyms: ['salary', 'pay', 'compensation', 'stipend', 'wage', 'pay range'],
  },
  authors: {
    label: 'Authors',
    valueKind: 'text',
    keywords: ['Authors', 'Author', 'By'],
    sources: ['meta.citation_author', 'article.author', 'meta.author', 'keywords'],
    synonyms: ['author', 'authors', 'by', 'researchers'],
  },
  abstract: {
    label: 'Abstract / summary',
    valueKind: 'longtext',
    keywords: ['Abstract', 'Summary'],
    sources: ['meta.citation_abstract', 'keywords', 'meta.description', 'meta.og:description'],
    synonyms: ['abstract', 'summary', 'description', 'about'],
  },
  published: {
    label: 'Published date',
    valueKind: 'date',
    keywords: ['Published', 'Date Posted', 'Posted on', 'Posted', 'Submitted', 'Publication date'],
    sources: [
      'meta.citation_publication_date', 'meta.citation_date', 'meta.article:published_time',
      'article.datePublished', 'jobposting.datePosted', 'keywords',
    ],
    synonyms: ['published', 'publication date', 'date posted', 'posted', 'posted on', 'pub date', 'year'],
  },
  pageTitle: {
    label: 'Page title',
    sources: ['title.raw'],
    synonyms: ['page title', 'page', 'paper', 'paper title', 'article'],
  },
  url: {
    label: 'Page URL',
    sources: ['url'],
    synonyms: ['url', 'link', 'website', 'job link', 'posting', 'posting url', 'source', 'application link', 'apply link'],
  },
  dateSaved: {
    label: 'Date saved (today)',
    sources: ['today'],
    synonyms: ['date saved', 'date added', 'saved', 'added', 'saved on', 'date', 'date applied', 'applied on', 'applied'],
  },
};

/** Header text used when SheetGrab creates a column, in the order new columns are added. */
export const STANDARD_HEADERS = {
  company: 'Company',
  jobTitle: 'Role',
  deadline: 'Deadline',
  contact: 'Contact',
  location: 'Location',
  salary: 'Salary',
  authors: 'Authors',
  abstract: 'Abstract',
  published: 'Published',
  pageTitle: 'Page Title',
  url: 'Link',
  dateSaved: 'Date Saved',
};

/** Columns a new Sheet gets by default. */
export const DEFAULT_WANTED = ['company', 'jobTitle', 'deadline', 'contact', 'url', 'dateSaved'];

/**
 * Adds a pending column for every wanted field that no existing column covers.
 * Pending columns are created in the Sheet when settings are saved.
 *   columns: [{ index, header, rule, pending? }]   headerWidth: cells in row 1
 * Pure; previous pending columns are rebuilt, keeping any keyword edits.
 */
export function planColumns(columns, wanted, headerWidth = 0) {
  const real = columns.filter((c) => !c.pending);
  const oldPending = new Map(columns.filter((c) => c.pending).map((c) => [c.rule.type, c]));
  const mapped = new Set(real.map((c) => c.rule?.type));
  const names = new Set(real.map((c) => c.header.trim().toLowerCase()));
  let next = Math.max(headerWidth, 0, ...real.map((c) => c.index + 1));

  const pending = [];
  for (const [type, header] of Object.entries(STANDARD_HEADERS)) {
    if (!wanted.includes(type) || mapped.has(type)) continue;
    // A column with this name exists but the user mapped it to something else: respect that.
    if (names.has(header.toLowerCase())) continue;
    const rule = oldPending.get(type)?.rule || defaultRule(type);
    pending.push({ index: next++, header, rule, pending: true });
  }
  return [...real, ...pending];
}

export const GENERIC_TYPES = {
  keyword: { label: 'Custom keywords' },
  regex: { label: 'Custom regex' },
  blank: { label: 'Leave blank' },
};

export const VALUE_KINDS = {
  text: 'Short text',
  name: 'Name / title',
  date: 'Date',
  person: 'Person or email',
  email: 'Email',
  longtext: 'Long text',
};

/** Rule types whose keyword list the user can edit. */
export function usesKeywords(type) {
  return type === 'keyword' || Boolean(PRESETS[type]?.sources.includes('keywords'));
}

export function defaultRule(type) {
  if (type === 'keyword') return { type, keywords: [], valueKind: 'text' };
  if (type === 'regex') return { type, pattern: '' };
  if (PRESETS[type]?.keywords) return { type, keywords: [...PRESETS[type].keywords] };
  return { type };
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Guess a rule for a Sheet column header. Unknown headers become 'blank'. */
export function autoMap(header) {
  const h = norm(header);
  if (!h) return defaultRule('blank');

  // 1. Exact synonym match.
  for (const [type, p] of Object.entries(PRESETS)) {
    if (p.synonyms.some((s) => norm(s) === h)) return defaultRule(type);
  }
  // 2. Longest synonym contained as whole words ("Date Posted" -> published, not dateSaved's "date").
  let best = null;
  for (const [type, p] of Object.entries(PRESETS)) {
    for (const s of p.synonyms) {
      const ns = norm(s);
      if (` ${h} `.includes(` ${ns} `) && (!best || ns.length > best.len)) best = { type, len: ns.length };
    }
  }
  return defaultRule(best ? best.type : 'blank');
}
