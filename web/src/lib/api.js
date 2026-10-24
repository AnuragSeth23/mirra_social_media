export class ApiError extends Error {
  status;
  code;
  details;

  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Field-level messages keyed by field name, for inline form errors. */
  get fields() {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(this.details.map((d) => [d.field, d.message]));
  }
}

const BASE = '/api/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The access token lives only in memory. The refresh token is an httpOnly cookie JavaScript can't read.
let accessToken = null;
export const setAccessToken = (token) => {
  accessToken = token;
};

// Told when a session that was working can no longer be refreshed (signed out elsewhere, password changed), so the UI can go to sign-in.
let onSignedOut = null;
export const setSignedOutHandler = (fn) => {
  onSignedOut = fn;
};

async function raw(path, method, body, withAuth = true) {
  try {
    return await fetch(BASE + path, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-SocialAmbak-Client': 'web',
        ...(withAuth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', "Can't reach SocialAmbak. Check your connection and try again.");
  }
}

async function parse(res) {
  if (res.status === 204) return undefined;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, json?.error?.code ?? 'unknown', json?.error?.message ?? 'Something went wrong. Try again.', json?.error?.details);
  }
  return json.data;
}

let refreshing = null;

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession() {
  refreshing ??= (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await raw('/auth/refresh', 'POST', undefined, false);
      if (res.status === 409) {
        await sleep(250);
        continue;
      } // another tab rotated it a moment ago
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const session = await parse(res);
      accessToken = session.accessToken;
      return session;
    }
    return null;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** Uploads one photo or video as raw bytes; returns the storage key to attach to a post, story or avatar. */
export async function uploadMedia(file) {
  const send = () =>
    fetch(BASE + '/media', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': file.type.split(';')[0], 'X-SocialAmbak-Client': 'web', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: file,
    }).catch(() => {
      throw new ApiError(0, 'network', "Can't reach SocialAmbak. Check your connection and try again.");
    });
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  return parse(res);
}

/** Calls the API; on an expired access token, refreshes once and retries. */
export async function api(path, opts = {}) {
  const { method = 'GET', body, auth = true } = opts;
  let res = await raw(path, method, body, auth);
  if (res.status === 401 && auth && accessToken) {
    if (await refreshSession()) res = await raw(path, method, body, auth);
    else {
      accessToken = null;
      onSignedOut?.();
    }
  }
  return parse(res);
}
