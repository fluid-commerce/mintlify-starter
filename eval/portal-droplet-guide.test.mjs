import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const guide = readFileSync(new URL('../portal-widgets/widget-packages/droplet-data.mdx', import.meta.url), 'utf8');
function example(name) {
  const start = guide.indexOf('```js title="' + name + '"\n');
  assert.notEqual(start, -1);
  return guide.slice(start).split('\n').slice(1).join('\n').split('\n```')[0].replace(/^import .*;\n/gm, '').replace(/export /g, '');
}
const member = { id: 'native-member', public_id: 'public-member', external_id: null };
function worker(query) {
  const texts = [];
  let cleanup;
  const exports = new Function('createElement', 'useEffect', 'useState', 'defineWidget', 'queryDropletData', example('member-echo-widget.js') + '\nreturn { MemberEchoCard, memberEchoWidget };')(
    (tag, props, text) => ({ tag, props, text }),
    effect => { cleanup = effect(); },
    initial => { texts.push(initial); return [initial, text => texts.push(text)]; },
    definition => definition, query,
  );
  exports.MemberEchoCard();
  return { texts, unmount: () => cleanup(), definition: exports.memberEchoWidget };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('worker declares actual function and queries only configured Droplet operation', async () => {
  let input;
  const query = async value => { input = value; return { member: { ...member, private_field: 'must not display' } }; };
  const widget = worker(query);
  await flush();
  assert.deepEqual(widget.definition.uses, [query]);
  assert.deepEqual(input, { dropletUuid: 'drp_acme_rewards', operation: 'member.echo', params: {} });
  assert.deepEqual(JSON.parse(widget.texts.at(-1)), member);
  assert.ok(!widget.texts.some(text => text.includes('must not display')));
});
test('worker refuses late results after unmount', async () => {
  let finish;
  const widget = worker(() => new Promise(resolve => { finish = resolve; }));
  widget.unmount();
  finish({ member });
  await flush();
  assert.deepEqual(widget.texts, ['Loading member…', 'Loading member…']);
});
test('rejected or malformed capability results become unavailable', async () => {
  for (const result of [null, [], { member: { id: 1 } }]) {
    const widget = worker(async () => result);
    await flush();
    assert.equal(widget.texts.at(-1), 'Member data is unavailable');
  }
  const widget = worker(async () => { throw new Error('NOT_GRANTED'); });
  await flush();
  assert.equal(widget.texts.at(-1), 'Member data is unavailable');
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
