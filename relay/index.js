// The sign-in relay of Storymap to GitHub, a Cloudflare Worker.
//
// GitHub's device flow endpoints (github.com/login/...) send no CORS headers,
// so a Figma plugin cannot call them from its window. This Worker forwards
// exactly two calls, adds the CORS headers, and keeps nothing: no secret
// (the device flow needs none), no token, no log.
//
//   POST /device/code             -> POST github.com/login/device/code
//   POST /token { device_code }   -> POST github.com/login/oauth/access_token
//
// The client id and the scopes are set here, not by the caller, so the relay
// only ever signs people in to this one app.

const SCOPES = 'repo project read:org';
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function forward(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'storymap-to-github-relay' },
    body: new URLSearchParams(params).toString(),
  });
  // GitHub answers 200 with an "error" field while the user has not
  // authorized yet; the plugin reads that field, so it is passed as is.
  const body = await res.json().catch(() => ({ error: 'bad_gateway' }));
  return json(body, res.ok ? 200 : 502);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!env.GITHUB_CLIENT_ID) return json({ error: 'not_configured' }, 500);
    const { pathname } = new URL(request.url);

    if (pathname === '/device/code') {
      return forward('https://github.com/login/device/code', { client_id: env.GITHUB_CLIENT_ID, scope: SCOPES });
    }

    if (pathname === '/token') {
      const text = await request.text();
      if (text.length > 1000) return json({ error: 'too_large' }, 413);
      let deviceCode = '';
      try {
        deviceCode = String(JSON.parse(text).device_code || '');
      } catch {
        return json({ error: 'bad_request' }, 400);
      }
      if (!/^[A-Za-z0-9_-]{10,100}$/.test(deviceCode)) return json({ error: 'incorrect_device_code' }, 400);
      return forward('https://github.com/login/oauth/access_token', { client_id: env.GITHUB_CLIENT_ID, device_code: deviceCode, grant_type: GRANT });
    }

    return json({ error: 'not_found' }, 404);
  },
};
