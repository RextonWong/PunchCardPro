-- Run against the isolated local database only. Every fixture rolls back.
begin;
do $$
declare
  email_key text := repeat('a', 64);
  ip_key text := repeat('b', 64);
  code_hash text := repeat('c', 64);
  wrong_hash text := repeat('d', 64);
  challenge_id uuid := gen_random_uuid();
  next_id uuid;
  response jsonb;
begin
  response := public.auth_otp_issue(email_key, ip_key, 'signup', challenge_id, code_hash);
  assert (response->>'ok')::boolean, 'Initial issuance must succeed';
  assert (response->>'expires_at')::timestamptz > now() + interval '299 seconds', 'Five-minute expiry';
  assert not (public.auth_otp_issue(email_key, ip_key, 'signup', gen_random_uuid(), code_hash)->>'ok')::boolean, 'Resends require 60 seconds';
  for guess in 1..3 loop
    response := public.auth_otp_verify(email_key, 'signup', challenge_id, wrong_hash);
    assert not (response->>'ok')::boolean, 'Wrong codes cannot verify';
    assert (response->>'attempts_remaining')::integer = 3 - guess, 'Attempts must decrease atomically';
  end loop;
  assert not (public.auth_otp_verify(email_key, 'signup', challenge_id, code_hash)->>'ok')::boolean, 'Correct code must fail after three guesses';

  update public.auth_otp_limits set last_sent_at = now() - interval '61 seconds' where key = 'email:' || email_key;
  challenge_id := gen_random_uuid();
  assert (public.auth_otp_issue(email_key, ip_key, 'signup', challenge_id, code_hash)->>'ok')::boolean, 'Second issuance succeeds after resend delay';
  update public.auth_otp_limits set last_sent_at = now() - interval '61 seconds' where key = 'email:' || email_key;
  next_id := gen_random_uuid();
  assert (public.auth_otp_issue(email_key, ip_key, 'signup', next_id, code_hash)->>'ok')::boolean, 'Third issuance succeeds';
  assert not (public.auth_otp_verify(email_key, 'signup', challenge_id, code_hash)->>'ok')::boolean, 'Resend invalidates older code';
  assert (public.auth_otp_verify(email_key, 'signup', next_id, code_hash)->>'ok')::boolean, 'Current correct code works';
  assert not (public.auth_otp_verify(email_key, 'signup', next_id, code_hash)->>'ok')::boolean, 'Code is single-use';

  update public.auth_otp_limits set last_sent_at = now() - interval '61 seconds' where key = 'email:' || email_key;
  challenge_id := gen_random_uuid();
  assert (public.auth_otp_issue(email_key, ip_key, 'signup', challenge_id, code_hash)->>'ok')::boolean, 'Fourth issuance';
  update public.auth_otp_challenges set expires_at = now() - interval '1 second' where id = challenge_id;
  assert not (public.auth_otp_verify(email_key, 'signup', challenge_id, code_hash)->>'ok')::boolean, 'Expired codes fail';

  update public.auth_otp_limits set last_sent_at = now() - interval '61 seconds' where key = 'email:' || email_key;
  challenge_id := gen_random_uuid();
  assert (public.auth_otp_issue(email_key, ip_key, 'recovery', challenge_id, code_hash)->>'ok')::boolean, 'Fifth code is allowed across purposes';
  response := public.auth_otp_issue(email_key, ip_key, 'signup', gen_random_uuid(), code_hash);
  assert not (response->>'ok')::boolean and (response->>'retry_after')::integer >= 3599, 'Sixth code is blocked for one hour';
  assert (public.auth_otp_verify(email_key, 'recovery', challenge_id, code_hash)->>'ok')::boolean, 'Fifth code still verifies during request freeze';

  update public.auth_otp_limits set blocked_until = now() - interval '1 second', window_start = now() - interval '61 minutes', last_sent_at = now() - interval '61 minutes' where key = 'email:' || email_key;
  assert (public.auth_otp_issue(email_key, ip_key, 'signup', gen_random_uuid(), code_hash)->>'ok')::boolean, 'Requests resume after cooldown';
  update public.auth_otp_limits set requests = 20 where key = 'ip:' || ip_key;
  assert not (public.auth_otp_issue(repeat('e',64), ip_key, 'signup', gen_random_uuid(), code_hash)->>'ok')::boolean, 'IP issuance cap works';

  assert not has_function_privilege('anon', 'public.auth_otp_issue(text,text,text,uuid,text)', 'EXECUTE'), 'Anon cannot issue via RPC';
  assert not has_function_privilege('authenticated', 'public.auth_otp_verify(text,text,uuid,text)', 'EXECUTE'), 'Authenticated clients cannot bypass verification';
  assert not has_function_privilege('anon', 'public.auth_otp_find_user(text)', 'EXECUTE'), 'Account lookup is private';
  assert not has_table_privilege('authenticated', 'public.auth_otp_challenges', 'SELECT'), 'OTP hashes are private';
  raise notice 'PASS: expiry, guesses, replay, resend, email/IP cooldown, and RPC/table privileges';
end;
$$;
rollback;
