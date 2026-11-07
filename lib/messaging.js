// Calls the service worker and unwraps { ok, data } / { ok: false, error, code }.
export async function send(type, args = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...args });
  if (!res) throw Object.assign(new Error('No response from the extension background.'), { code: 'ERROR' });
  if (!res.ok) throw Object.assign(new Error(res.error), { code: res.code });
  return res.data;
}
