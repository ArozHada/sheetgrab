// OAuth token lifecycle via chrome.identity (Chrome's built-in Google sign-in).
// Tokens never leave the browser except to Google's own APIs.

export class AuthError extends Error {
  constructor(message = 'Not connected to Google. Open Settings and click "Connect Google Account".') {
    super(message);
    this.code = 'AUTH';
  }
}

/** Returns an access token, or throws AuthError. */
export async function getToken({ interactive = false } = {}) {
  try {
    const result = await chrome.identity.getAuthToken({ interactive });
    // Older Chrome versions resolve with a string, newer ones with { token, grantedScopes }.
    const token = typeof result === 'string' ? result : result?.token;
    if (!token) throw new AuthError();
    return token;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError(interactive ? `Google sign-in failed: ${err.message}` : undefined);
  }
}

export async function isSignedIn() {
  try {
    await getToken({ interactive: false });
    return true;
  } catch {
    return false;
  }
}

export async function signOut() {
  let token;
  try {
    token = await getToken({ interactive: false });
  } catch {
    return; // already signed out
  }
  await chrome.identity.removeCachedAuthToken({ token });
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    // Revocation is best-effort; the cached token is already gone.
  }
}

/**
 * fetch() with a Bearer token. If Google rejects the token (401), the cached
 * token is dropped and the request is retried once with a fresh one.
 */
export async function authedFetch(url, init = {}) {
  let token = await getToken();
  let res = await fetch(url, withAuth(init, token));
  if (res.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token });
    token = await getToken();
    res = await fetch(url, withAuth(init, token));
    if (res.status === 401) throw new AuthError('Your Google session expired. Reconnect in Settings.');
  }
  return res;
}

function withAuth(init, token) {
  return { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } };
}
