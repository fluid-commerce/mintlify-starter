import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const guide = readFileSync(new URL('../portal-widgets/widget-packages/droplet-data.mdx', import.meta.url), 'utf8');
function example(name) {
  const start = guide.indexOf('```js title="' + name + '"\n');
  assert.notEqual(start, -1);
  return guide.slice(start).split('\n').slice(1).join('\n').split('\n```')[0].replace(/^import .*;\n/gm, '').replace(/export /g, '');
}
function host(fetch, csrf = 'real-host-token') {
  return new Function('implementPortalFunction', 'readDropletMember', 'document', 'fetch', example('droplet-member-host.js') + '\nreturn createDropletMemberBridge;')(
    (_, handler) => handler, {}, { querySelector: () => csrf ? { content: csrf } : null }, fetch,
  )('drp_acme_rewards');
}
const member = { id: 'native-member', public_id: 'public-member', external_id: null };
test('host fixes selector/operation, uses Portal CSRF/cookies and unwraps only data', async () => {
  let request;
  const bridge = host(async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ data: { member: { ...member, private_unapproved_field: "must not cross worker bridge" } }, status: 200 }) }; });
  assert.deepEqual(await bridge.implementation(), { member });
  assert.equal(request.url, '/api/member/v2026-10/droplet-queries');
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.headers['X-CSRF-Token'], 'real-host-token');
  assert.deepEqual(JSON.parse(request.options.body), { droplet_uuid: 'drp_acme_rewards', operation: 'member.echo', params: {} });
  bridge.dispose();
  await assert.rejects(bridge.implementation(), /scope ended/);
});
test('disposal rejects late response even when transport ignores abort', async () => {
  let finish;
  const bridge = host(async () => ({ ok: true, json: () => new Promise(resolve => { finish = resolve; }) }));
  const pending = bridge.implementation();
  await Promise.resolve();
  bridge.dispose();
  finish({ data: { member } });
  await assert.rejects(pending, /scope ended/);
});
test('missing CSRF never fetches; errors/malformed responses never return private results', async () => {
  const absent = host(() => { throw new Error('must not fetch'); }, null);
  await assert.rejects(absent.implementation(), /CSRF/);
  for (const response of [{ ok: false, json: async () => ({ error: { details: { backend_response: 'private' } } }) }, { ok: true, json: async () => ({ data: { member: [] } }) }]) {
    await assert.rejects(host(async () => response).implementation());
  }
});
test('receiver preserves exact verified member and rejects unsigned or injected operations', async () => {
  let signedBytes;
  const build = valid => new Function('verifySignature', example('member-echo-receiver.js') + '\nreturn receiveMemberEcho;')(({ rawBody }) => { signedBytes = rawBody; return { valid }; });
  const body = JSON.stringify({ company: { id: 1842, fluid_shop: 'northwind.fluid.app' }, member: { ...member, future_signed_field: 'preserved' }, operation: 'member.echo', params: {} });
  const request = value => new Request('https://receiver.example/query', { method: 'POST', headers: { 'X-Fluid-Shop': 'northwind.fluid.app' }, body: value });
  const response = await build(true)(request(body), 'server-only-secret');
  assert.equal(signedBytes.toString(), body);
  assert.deepEqual(await response.json(), { member: JSON.parse(body).member });
  assert.equal((await build(false)(request(body), 'secret')).status, 401);
  assert.equal((await build(true)(request('{invalid'), 'secret')).status, 400);
  assert.equal((await build(true)(request(body.replace('northwind.fluid.app', 'another.fluid.app')), 'secret')).status, 422);
  assert.equal((await build(true)(request(body.replace('\"id\":\"native-member\"', '\"id\":null')), 'secret')).status, 422);
  assert.equal((await build(true)(request(body.replace('member.echo', 'member.write')), 'secret')).status, 422);
  assert.equal((await build(true)(request(body.replace('"params":{}', '"params":{"member_id":"other"}')), 'secret')).status, 422);
});
