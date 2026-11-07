// Injected into the active tab with chrome.scripting.executeScript({ func: collectPageData }).
// Chrome serializes this function's source, so it must be self-contained:
// no imports and no references to anything outside its body.
// It only gathers raw page data. Extraction happens in the popup (lib/extract.js).
export function collectPageData() {
  const MAX_TEXT = 300000;
  const meta = {};
  for (const el of document.querySelectorAll('meta[content]')) {
    const key = (el.getAttribute('name') || el.getAttribute('property') || el.getAttribute('itemprop') || '')
      .toLowerCase()
      .trim();
    const value = (el.getAttribute('content') || '').trim();
    if (!key || !value) continue;
    (meta[key] ||= []).push(value);
  }

  const jsonld = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      jsonld.push(JSON.parse(s.textContent));
    } catch {
      // Ignore malformed blocks.
    }
  }

  return {
    url: location.href,
    title: document.title || '',
    text: (document.body?.innerText || '').slice(0, MAX_TEXT),
    selection: String(window.getSelection?.() || '').slice(0, 20000),
    meta,
    jsonld,
  };
}
