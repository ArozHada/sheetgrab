// Tiny DOM builder. Text is always set with textContent, so page-derived
// strings can never be interpreted as HTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Sets a .msg element's text and tone ('error' | 'warn' | 'ok' | 'info'), or clears it. */
export function setMsg(el, text = '', tone = 'info') {
  el.className = `msg ${tone}`;
  el.textContent = text;
}
