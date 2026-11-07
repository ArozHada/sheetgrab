#!/usr/bin/env node
// Builds the Chrome Web Store upload: dist/sheetgrab-<version>.zip
//
//   npm run package                 runs the tests, then builds and zips
//   npm run package -- --skip-tests
//
// What it does:
//  - copies only runtime files into dist/build/
//  - removes "key" from the manifest (the store assigns its own ID and rejects uploads with a key)
//  - drops a placeholder homepage_url, with a warning
//  - fails if the OAuth client_id is a placeholder or a referenced file is missing
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const build = join(dist, 'build');
const RUNTIME = ['manifest.json', 'background', 'content', 'lib', 'popup', 'options', 'styles', 'icons'];

const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};
const warn = (msg) => console.warn(`⚠ ${msg}`);

// 1. Tests
if (!process.argv.includes('--skip-tests')) {
  console.log('Running tests…');
  try {
    execFileSync(process.execPath, ['--test'], { cwd: root, stdio: 'inherit' });
  } catch {
    fail('Tests failed. Fix them or pass --skip-tests.');
  }
}

// 2. Manifest checks
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const clientId = manifest.oauth2?.client_id || '';
if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId)) {
  fail(`manifest.json oauth2.client_id looks like a placeholder: "${clientId}"`);
}
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version || '')) fail(`Invalid version "${manifest.version}"`);
if ((manifest.description || '').length > 132) fail('Manifest description must be 132 characters or fewer.');

// 3. Copy runtime files
rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });
for (const entry of RUNTIME) {
  const src = join(root, entry);
  if (!existsSync(src)) fail(`Missing ${entry}`);
  cpSync(src, join(build, entry), { recursive: true, filter: (p) => !p.endsWith('.DS_Store') });
}

// 4. Store manifest
const storeManifest = { ...manifest };
delete storeManifest.key;
if (/YOUR-|example\.com/i.test(storeManifest.homepage_url || '')) {
  warn('homepage_url is still a placeholder, so it was left out of this build. Set it once your docs/ page is hosted.');
  delete storeManifest.homepage_url;
}
writeFileSync(join(build, 'manifest.json'), `${JSON.stringify(storeManifest, null, 2)}\n`);

// 5. Every file referenced by the manifest, HTML and JS must exist in the build
const missing = [];
const check = (from, ref) => {
  if (!ref || /^(?:[a-z]+:|\/\/|#)/i.test(ref)) return; // external URL or anchor
  const target = ref.startsWith('/') ? join(build, ref) : join(dirname(from), ref);
  if (!existsSync(target)) missing.push(`${relative(build, from)} → ${ref}`);
};
const m = storeManifest;
const manifestFile = join(build, 'manifest.json');
[
  m.action?.default_popup,
  m.options_page,
  m.background?.service_worker,
  ...Object.values(m.icons || {}),
  ...Object.values(m.action?.default_icon || {}),
].forEach((ref) => check(manifestFile, ref));

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
for (const file of walk(build)) {
  const ext = extname(file);
  if (ext !== '.html' && ext !== '.js') continue;
  const src = readFileSync(file, 'utf8');
  const refs =
    ext === '.html'
      ? [...src.matchAll(/(?:src|href)="([^"]+)"/g)].map((x) => x[1])
      : [...src.matchAll(/(?:import|from)\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((x) => x[1]);
  refs.forEach((ref) => check(file, ref));
}
if (missing.length) fail(`Missing referenced files:\n  ${missing.join('\n  ')}`);

// 6. Zip
const zipPath = join(dist, `sheetgrab-${manifest.version}.zip`);
rmSync(zipPath, { force: true });
try {
  execFileSync('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: build, stdio: 'inherit' });
} catch {
  fail('The `zip` command failed. Is it installed?');
}

const kb = (statSync(zipPath).size / 1024).toFixed(1);
console.log(`\n✔ Built ${relative(root, zipPath)} (${kb} KB) from ${relative(root, build)}/`);
console.log('  "key" was removed. The Chrome Web Store assigns the extension ID on first upload.');
console.log('  Remember to bump "version" in manifest.json before each new upload.\n');
