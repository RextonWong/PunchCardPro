import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAdmin } from '../supabase/functions/admin-api/handler.mjs';
const id = '11111111-1111-4111-8111-111111111111';
function db(admin = false) {
  const calls = [];
  return { calls, auth: { getUser: async () => ({ data: { user: { id } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: admin ? { user_id: id } : null }) }) }) }),
    rpc: async (name, args) => { calls.push({ name, args }); return { data: { users: [], total: 0 } }; },
  };
}
const req = body => new Request('http://localhost/admin-api', { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('anonymous and non-admin users cannot read users or mutate accounts', async () => {
  const backend = db();
  assert.equal((await handleAdmin(new Request('http://localhost', { method: 'POST' }), backend)).status,401);
  for (const action of ['users','suspend','restore','audit']) assert.equal((await handleAdmin(req({ action }), backend)).status,403);
  assert.equal(backend.calls.length,0);
});
test('admin filters are bounded and actor is taken from verified token', async () => {
  const backend = db(true);
  assert.equal((await handleAdmin(req({ action: 'users', page: -1 }),backend)).status,400);
  assert.equal((await handleAdmin(req({ action: 'users', days: 365 }),backend)).status,400);
  assert.equal((await handleAdmin(req({ action: 'users', days: 30, page: 2 }),backend)).status,200);
  assert.equal(backend.calls[0].args.p_page,2);
  const target = '22222222-2222-4222-8222-222222222222';
  assert.equal((await handleAdmin(req({ action: 'suspend', userId: target, actor: target }),backend)).status,200);
  assert.equal(backend.calls[1].args.p_actor,id);
  assert.equal(backend.calls[1].args.p_suspended,true);
  assert.equal((await handleAdmin(req({ action: 'suspend', userId: id }),backend)).status,400);
});
test('role lookup errors fail closed without leaking server details', async () => {
  const backend = db(true);
  backend.from = () => { throw new Error('private secret'); };
  const response = await handleAdmin(req({ action: 'users' }),backend);
  assert.equal(response.status,500);
  assert.doesNotMatch(await response.text(),/private secret/);
});
