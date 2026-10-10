import assert from 'node:assert/strict';
import test from 'node:test';
import { createOtpHandler, localSandbox, randomCode } from '../supabase/functions/auth-otp/handler.mjs';

test('fixed sandbox OTP cannot be selected for a hosted Supabase URL', () => {
  assert.equal(localSandbox('http://kong:8000'), true);
  assert.equal(localSandbox('http://127.0.0.1:54321'), true);
  assert.equal(localSandbox('https://project.supabase.co'), false);
  assert.equal(localSandbox('https://localhost'), false);
  assert.equal(localSandbox('http://localhost.attacker.example'), false);
  for (let i = 0; i < 100; i++) assert.match(randomCode(), /^\d{6}$/);
});

test('untrusted origins and malformed bodies never reach OTP storage or account creation', async () => {
  let mutations = 0;
  const handler = createOtpHandler({ secret: 'test-secret', isSandbox: true, allowedOrigins: ['http://localhost:5173'], store: { issue: () => mutations++, verify: () => mutations++ }, auth: { createUser: () => mutations++ } });
  const untrusted = await handler(new Request('http://local', { method: 'POST', headers: { origin: 'https://attacker.example' }, body: '{}' }));
  assert.equal(untrusted.status, 403);
  for (const body of ['null', '{', '[]', JSON.stringify({ email: 'not-an-email', purpose: 'signup' })]) {
    assert.equal((await handler(new Request('http://local', { method: 'POST', body }))).status, 400);
  }
  assert.equal(mutations, 0);
});

test('request responses are identical for existing and missing accounts and never reveal codes', async () => {
  let mails = 0;
  const handler = createOtpHandler({ secret: 'test-secret', isSandbox: false, allowedOrigins: [], store: { issue: async () => ({ ok: true, expires_at: '2026-10-10T01:05:00Z', resend_at: '2026-10-10T01:01:00Z' }) }, auth: { findUser: async (email) => email.startsWith('exists') ? 'user-id' : null }, sendEmail: async () => mails++ });
  const replies = [];
  for (const email of ['exists@example.com', 'missing@example.com']) {
    const reply = await handler(new Request('http://local', { method: 'POST', body: JSON.stringify({ action: 'request', purpose: 'recovery', email }) }));
    const data = await reply.json();
    assert.equal(data.code, undefined);
    delete data.challenge_id;
    replies.push(data);
  }
  assert.deepEqual(replies[0], replies[1]);
  assert.equal(mails, 1);
});
