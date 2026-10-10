import assert from 'node:assert/strict';
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const status = JSON.parse(execSync('npx supabase status --output json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
assert.ok(['localhost', '127.0.0.1'].includes(new URL(status.API_URL).hostname), 'Tests may only target local Supabase');
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const client = () => createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const password = 'SandboxPassword123!';
const createdUsers = [];
const emails = [];
const newEmail = () => {
  const email = `sandbox-${randomUUID()}@example.com`;
  emails.push(email);
  return email;
};
const emailKey = (email) => createHmac('sha256', status.SERVICE_ROLE_KEY).update(`email:${email}`).digest('hex');
async function call(body) {
  const response = await fetch(`${status.API_URL}/functions/v1/auth-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: status.ANON_KEY, Origin: 'http://localhost:5173' }, body: JSON.stringify(body) });
  return { status: response.status, ...await response.json() };
}
const request = (email, purpose = 'signup') => call({ action: 'request', email, purpose });
const verify = (email, challenge, code = '123321', purpose = 'signup', newPassword = password) => call({ action: 'verify', email, purpose, challenge_id: challenge.challenge_id, code, password: newPassword });
async function allowResend(email) {
  const { error } = await admin.from('auth_otp_limits').update({ last_sent_at: new Date(Date.now() - 61000).toISOString() }).eq('key', `email:${emailKey(email)}`);
  if (error) throw error;
}

try {
  // SQL fixtures prove the limits and privileges on the real database, then roll back.
  execFileSync('docker', ['exec', '-i', 'supabase_db_lori-hantu-dashboard', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: readFileSync('supabase/tests/auth_otp_guards.sql'), stdio: ['pipe', 'pipe', 'pipe'] });
  console.log('PASS: SQL expiry, attempts, replay, resend, cooldown, IP cap, and private RPC/table permissions');

  const email = newEmail();
  const challenge = await request(email);
  assert.equal(challenge.status, 200, challenge.error);
  assert.equal((await verify(email, challenge, '000000')).attempts_remaining, 2);
  assert.equal((await verify(email, challenge, '000000')).attempts_remaining, 1);
  assert.equal((await verify(email, challenge)).status, 200);
  const { data: userId } = await admin.rpc('auth_otp_find_user', { p_email: email });
  assert.ok(userId);
  createdUsers.push(userId);
  assert.equal((await verify(email, challenge)).status, 400, 'Code replay must fail');
  const firstClient = client();
  const { data: signedIn, error: signInError } = await firstClient.auth.signInWithPassword({ email, password });
  assert.equal(signInError, null);
  assert.ok(signedIn.session);
  const oldRefreshToken = signedIn.session.refresh_token;
  assert.equal((await request(email, 'recovery')).status, 429, 'Server enforces resend delay across purposes');
  await allowResend(email);
  const recovery = await request(email, 'recovery');
  assert.equal(recovery.status, 200, recovery.error);
  const newPassword = 'ChangedSandboxPassword123!';
  const reset = await verify(email, recovery, '123321', 'recovery', newPassword);
  assert.equal(reset.status, 200, reset.error);
  assert.ok((await client().auth.signInWithPassword({ email, password })).error, 'Old password must fail');
  assert.equal((await client().auth.signInWithPassword({ email, password: newPassword })).error, null);
  assert.ok((await client().auth.refreshSession({ refresh_token: oldRefreshToken })).error, 'Old refresh session must be revoked');
  console.log('PASS: real sandbox signup after two mistakes, replay prevention, password reset, old-password rejection, and session revocation');

  const lockedEmail = newEmail();
  const locked = await request(lockedEmail);
  assert.equal(locked.status, 200, locked.error);
  const guesses = await Promise.all(Array.from({ length: 3 }, () => verify(lockedEmail, locked, '000000')));
  assert.deepEqual(guesses.map((result) => result.attempts_remaining).sort(), [0, 1, 2]);
  assert.equal((await verify(lockedEmail, locked)).status, 400, 'Three simultaneous guesses must exhaust the code');
  const { data: missingUser } = await admin.rpc('auth_otp_find_user', { p_email: lockedEmail });
  assert.equal(missingUser, null, 'Unverified email must not create an account');

  const expiredEmail = newEmail();
  const expired = await request(expiredEmail);
  assert.equal(expired.status, 200, expired.error);
  const { error: expireError } = await admin.from('auth_otp_challenges').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', expired.challenge_id);
  assert.equal(expireError, null);
  assert.equal((await verify(expiredEmail, expired)).status, 400, 'Expired sandbox code must fail');
  const directSignup = await client().auth.signUp({ email: newEmail(), password });
  assert.ok(directSignup.error, 'Direct native signup must be disabled');
  console.log('PASS: concurrent attempts, expiry, no unverified account, and no direct-signup bypass');
} finally {
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  const keys = emails.map(emailKey);
  await admin.from('auth_otp_challenges').delete().in('email_key', keys);
  await admin.from('auth_otp_limits').delete().in('key', keys.map((key) => `email:${key}`));
}
