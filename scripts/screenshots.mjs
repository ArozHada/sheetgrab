#!/usr/bin/env node
// Renders Chrome Web Store images into dist/store/ with headless Chrome:
//   screenshot-1-clip.png      1280×800  job posting + pre-filled popup
//   screenshot-2-saved.png     1280×800  "Added to Row 42"
//   screenshot-3-settings.png  1280×800  settings and column mapping
//   promo-440x280.png          small promo tile
//
// The real popup/options pages are served with a fake chrome.* API and fixture data.
// Set CHROME_PATH if Chrome isn't in the default macOS location.
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { autoMap } from '../lib/rules.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'store');
const CHROME =
  process.env.CHROME_PATH ||
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
if (!CHROME) {
  console.error('Chrome not found. Set CHROME_PATH.');
  process.exit(1);
}

const page = JSON.parse(readFileSync(join(root, 'tests/fixtures/greenhouse-like.json'), 'utf8'));
const headers = ['Company', 'Role', 'Deadline', 'Contact', 'Location', 'Salary', 'Link', 'Date Saved', 'Status'];
const config = {
  spreadsheetId: 'demo',
  spreadsheetTitle: 'Job Hunt 2026',
  sheetUrl: 'https://docs.google.com/spreadsheets/d/1DemoSheetIdForScreenshots000000/edit',
  sheetTitle: 'Applications',
  sheetGid: 0,
  columns: headers.map((header, index) => ({ index, header, rule: autoMap(header) })),
  wanted: ['company', 'jobTitle', 'deadline', 'contact', 'url', 'dateSaved'],
};

const stub = `
(() => {
  const page = ${JSON.stringify(page)};
  const config = ${JSON.stringify(config)};
  const reply = (data) => Promise.resolve({ ok: true, data });
  window.chrome = {
    runtime: {
      id: 'demo',
      openOptionsPage() {},
      sendMessage(m) {
        switch (m.type) {
          case 'auth:status': return reply({ signedIn: true });
          case 'sheets:tabs': return reply({ title: config.spreadsheetTitle, tabs: [{ title: 'Applications', sheetId: 0 }, { title: 'Archive', sheetId: 1 }] });
          case 'sheets:headers': return reply(${JSON.stringify(headers)});
          case 'sheets:appendByHeader': return reply({ row: 42, created: [] });
          default: return Promise.resolve({ ok: false, error: 'unsupported' });
        }
      },
    },
    storage: { sync: { get: async () => ({ config }), set: async () => {} } },
    tabs: { query: async () => [{ id: 1, url: page.url, title: page.title }], create() {} },
    scripting: { executeScript: async () => [{ result: page }] },
  };
  const q = new URLSearchParams(location.search);
  if (q.has('save')) {
    addEventListener('load', () => setTimeout(() => document.getElementById('form')?.requestSubmit(), 600));
  }
  if (q.has('scroll')) {
    // Settings: bring the column-mapping table into view. Headless screenshots
    // ignore scroll position, so shift the content instead.
    addEventListener('load', () =>
      setTimeout(() => {
        const wrap = document.querySelector('.wrap');
        const target = document.querySelectorAll('.card')[2];
        if (wrap && target) wrap.style.transform = \`translateY(-\${target.offsetTop - 24}px)\`;
      }, 600)
    );
  }
})();
`;

const css = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
`;

const showcase = (query) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}
  body { width: 1280px; height: 800px; background: #e9efeb; overflow: hidden; }
  .browser { position: absolute; inset: 28px 28px 0 28px; background: #fff; border-radius: 12px 12px 0 0; box-shadow: 0 8px 30px rgba(0,0,0,.12); overflow: hidden; }
  .chrome { height: 44px; background: #f1f3f2; display: flex; align-items: center; gap: 10px; padding: 0 16px; border-bottom: 1px solid #dde3df; }
  .dots span { display: inline-block; width: 11px; height: 11px; border-radius: 50%; background: #d0d6d2; margin-right: 6px; }
  .url { flex: 1; background: #fff; border-radius: 16px; padding: 6px 14px; font-size: 13px; color: #555; }
  .ext { width: 26px; height: 26px; border-radius: 6px; background: #dcefe3; display: grid; place-items: center; }
  .post { padding: 40px 56px; width: 700px; color: #1b1f1d; }
  .post .co { color: #1a7f4b; font-weight: 600; }
  .post h1 { font-size: 34px; margin: 6px 0 4px; }
  .post .meta { color: #5d6762; margin-bottom: 26px; }
  .post .apply { display: inline-block; background: #1a7f4b; color: #fff; padding: 10px 18px; border-radius: 8px; font-weight: 600; margin-bottom: 28px; }
  .post dl { display: grid; grid-template-columns: 160px 1fr; gap: 10px 16px; margin: 0 0 24px; font-size: 15px; }
  .post dt { color: #5d6762; } .post dd { margin: 0; font-weight: 500; }
  .post p { color: #444; line-height: 1.6; font-size: 15px; }
  iframe { position: absolute; top: 72px; right: 44px; width: 380px; height: ${query ? 250 : 532}px; border: 0; border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,.28); background: #fff; }
</style></head><body>
  <div class="browser">
    <div class="chrome"><div class="dots"><span></span><span></span><span></span></div>
      <div class="url">boards.greenhouse.io/globex/jobs/4455</div>
      <div class="ext"><img src="/icons/icon32.png" width="18" height="18" alt=""></div></div>
    <div class="post">
      <div class="co">Globex Corporation</div>
      <h1>Data Analyst</h1>
      <div class="meta">Austin, TX · Full-time · Analytics</div>
      <div class="apply">Apply for this job</div>
      <dl>
        <dt>Deadline</dt><dd>April 1st, 2026</dd>
        <dt>Hiring Manager</dt><dd>Dr. Maria Lopez</dd>
        <dt>Compensation</dt><dd>$85,000 – $105,000 per year</dd>
      </dl>
      <p>The role will be part of our analytics team, turning product and operations data into decisions.
      You'll build dashboards, design experiments and partner with engineering and finance.</p>
    </div>
  </div>
  <iframe src="/popup/popup.html${query}"></iframe>
</body></html>`;

const promo = `<!doctype html><html><head><meta charset="utf-8"><style>${css}
  body { width: 440px; height: 280px; background: linear-gradient(135deg, #1a7f4b, #0f5a34); color: #fff;
         display: flex; flex-direction: column; justify-content: center; padding: 0 36px; overflow: hidden; }
  .row { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
  img { background: #fff; border-radius: 14px; padding: 6px; }
  h1 { font-size: 36px; margin: 0; letter-spacing: -0.5px; }
  p { margin: 0; font-size: 18px; line-height: 1.35; opacity: .95; }
</style></head><body>
  <div class="row"><img src="/icons/icon48.png" width="56" height="56" alt=""><h1>SheetGrab</h1></div>
  <p>Clip any job posting into your Google Sheet in one click.</p>
</body></html>`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (body, type = 'text/html') => {
    res.setHeader('content-type', type);
    res.end(body);
  };
  if (url.pathname === '/__stub.js') return send(stub, 'text/javascript');
  if (url.pathname === '/__showcase.html') return send(showcase(url.searchParams.has('save') ? '?save' : ''));
  if (url.pathname === '/__promo.html') return send(promo);
  const file = join(root, url.pathname);
  if (!file.startsWith(root) || !existsSync(file)) {
    res.statusCode = 404;
    return res.end();
  }
  let body = readFileSync(file);
  if (extname(file) === '.html') {
    body = body.toString().replace('<script type="module"', '<script src="/__stub.js"></script><script type="module"');
  }
  send(body, TYPES[extname(file)] || 'application/octet-stream');
});

const run = promisify(execFile);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(join(tmpdir(), 'sheetgrab-shots-'));
mkdirSync(out, { recursive: true });

async function shoot(path, file, width, height) {
  await run(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    '--blink-settings=preferredColorScheme=1', // light theme
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--virtual-time-budget=4000',
    `--screenshot=${join(out, file)}`,
    `${base}${path}`,
  ]);
  console.log(`✔ dist/store/${file}`);
}

try {
  await shoot('/__showcase.html', 'screenshot-1-clip.png', 1280, 800);
  await shoot('/__showcase.html?save', 'screenshot-2-saved.png', 1280, 800);
  await shoot('/options/options.html?scroll', 'screenshot-3-settings.png', 1280, 800);
  await shoot('/__promo.html', 'promo-440x280.png', 440, 280);
} finally {
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
