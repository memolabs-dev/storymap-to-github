import test from 'node:test';
import assert from 'node:assert/strict';
import relay from '../relay/index.js';

const env = { GITHUB_CLIENT_ID: 'Ov23test' };
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, body: Object.fromEntries(new URLSearchParams(init.body)) });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
const post = (path, body) => relay.fetch(new Request(`https://relay.test${path}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }), env);

test('the relay asks GitHub for a device code with its own client id and scopes', async () => {
  calls.length = 0;
  const res = await post('/device/code', { client_id: 'someone-else', scope: 'admin:org' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(calls[0].url, 'https://github.com/login/device/code');
  assert.deepEqual(calls[0].body, { client_id: 'Ov23test', scope: 'repo project read:org' });
});

test('the relay polls for the token with the device code only', async () => {
  calls.length = 0;
  const res = await post('/token', { device_code: 'abc123def456ghi789' });
  assert.equal(res.status, 200);
  assert.equal(calls[0].url, 'https://github.com/login/oauth/access_token');
  assert.deepEqual(calls[0].body, { client_id: 'Ov23test', device_code: 'abc123def456ghi789', grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
});

test('the relay refuses anything else', async () => {
  calls.length = 0;
  assert.equal((await post('/token', { device_code: 'x&client_secret=1' })).status, 400);
  assert.equal((await post('/token')).status, 400);
  assert.equal((await post('/anything', {})).status, 404);
  assert.equal((await relay.fetch(new Request('https://relay.test/device/code'), env)).status, 405);
  assert.equal((await relay.fetch(new Request('https://relay.test/device/code', { method: 'OPTIONS' }), env)).status, 204);
  assert.equal(calls.length, 0, 'nothing reached GitHub');
});
