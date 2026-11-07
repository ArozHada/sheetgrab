// Message router: the popup and options page never hold tokens or call Google
// directly. They send { type, ...args } here and get { ok, data } or { ok: false, error, code }.
import { getToken, isSignedIn, signOut } from './auth.js';
import { getTabs, getHeaders, addHeaders, appendByHeader } from './sheets.js';

const handlers = {
  'auth:status': async () => ({ signedIn: await isSignedIn() }),
  'auth:signIn': async () => {
    await getToken({ interactive: true });
    return { signedIn: true };
  },
  'auth:signOut': async () => {
    await signOut();
    return { signedIn: false };
  },
  'sheets:tabs': ({ spreadsheetId }) => getTabs(spreadsheetId),
  'sheets:headers': ({ spreadsheetId, tab }) => getHeaders(spreadsheetId, tab),
  'sheets:addHeaders': ({ spreadsheetId, tab, headers }) => addHeaders(spreadsheetId, tab, headers),
  'sheets:appendByHeader': ({ spreadsheetId, tab, entries }) => appendByHeader(spreadsheetId, tab, entries),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from this extension's own pages.
  if (sender.id !== chrome.runtime.id) return false;
  const handler = handlers[msg?.type];
  if (!handler) return false;

  Promise.resolve()
    .then(() => handler(msg))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err), code: err.code || 'ERROR' }));
  return true; // keep the channel open for the async response
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
