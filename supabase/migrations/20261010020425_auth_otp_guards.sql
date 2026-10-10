-- These server-only tables store keyed hashes, never plaintext email addresses or OTPs.
create table public.auth_otp_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  requests integer not null default 0,
  last_sent_at timestamptz,
  blocked_until timestamptz
);
create table public.auth_otp_challenges (
  id uuid primary key,
  email_key text not null,
  purpose text not null check (purpose in ('signup', 'recovery')),
  code_hash text not null,
  attempts integer not null default 0 check (attempts between 0 and 3),
  expires_at timestamptz not null,
  consumed boolean not null default false
);
create index auth_otp_challenges_email_purpose on public.auth_otp_challenges (email_key, purpose);
alter table public.auth_otp_limits enable row level security;
alter table public.auth_otp_challenges enable row level security;
revoke all on public.auth_otp_limits, public.auth_otp_challenges from public, anon, authenticated;
grant all on public.auth_otp_limits, public.auth_otp_challenges to service_role;

create function public.auth_otp_issue(p_email_key text, p_ip_key text, p_purpose text, p_challenge_id uuid, p_code_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  email_limit public.auth_otp_limits;
  ip_limit public.auth_otp_limits;
  v_now timestamptz := clock_timestamp();
begin
  if p_purpose not in ('signup', 'recovery') or length(p_email_key) <> 64 or length(p_ip_key) <> 64 or length(p_code_hash) <> 64 then
    raise exception 'Invalid challenge';
  end if;
  insert into public.auth_otp_limits(key) values ('ip:' || p_ip_key), ('email:' || p_email_key) on conflict do nothing;
  -- Consistent lock order makes simultaneous requests across devices safe.
  select * into ip_limit from public.auth_otp_limits where key = 'ip:' || p_ip_key for update;
  select * into email_limit from public.auth_otp_limits where key = 'email:' || p_email_key for update;
  if ip_limit.window_start <= v_now - interval '1 hour' then
    ip_limit.window_start := v_now;
    ip_limit.requests := 0;
  end if;
  if email_limit.blocked_until > v_now then
    return jsonb_build_object('ok', false, 'error', 'Too many codes requested. Try again after the one-hour cooldown.', 'retry_after', ceil(extract(epoch from email_limit.blocked_until - v_now)));
  end if;
  if email_limit.window_start <= v_now - interval '1 hour' then
    email_limit.window_start := v_now;
    email_limit.requests := 0;
  end if;
  if ip_limit.requests >= 20 then
    return jsonb_build_object('ok', false, 'error', 'Too many requests from this connection. Try again later.', 'retry_after', ceil(extract(epoch from ip_limit.window_start + interval '1 hour' - v_now)));
  end if;
  if email_limit.last_sent_at > v_now - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'error', 'Wait 60 seconds before requesting another code.', 'retry_after', ceil(extract(epoch from email_limit.last_sent_at + interval '60 seconds' - v_now)));
  end if;
  update public.auth_otp_limits set window_start = ip_limit.window_start, requests = ip_limit.requests + 1 where key = 'ip:' || p_ip_key;
  update public.auth_otp_limits set window_start = email_limit.window_start, requests = email_limit.requests + 1, last_sent_at = v_now,
    blocked_until = case when email_limit.requests + 1 >= 5 then v_now + interval '1 hour' else null end
    where key = 'email:' || p_email_key;
  update public.auth_otp_challenges set consumed = true where email_key = p_email_key and purpose = p_purpose and not consumed;
  insert into public.auth_otp_challenges(id, email_key, purpose, code_hash, expires_at)
    values (p_challenge_id, p_email_key, p_purpose, p_code_hash, v_now + interval '5 minutes');
  -- Bound retention of expired challenges and inactive rate counters.
  delete from public.auth_otp_challenges where expires_at < v_now - interval '1 day';
  delete from public.auth_otp_limits where window_start < v_now - interval '2 days' and (blocked_until is null or blocked_until < v_now);
  return jsonb_build_object('ok', true, 'expires_at', v_now + interval '5 minutes', 'resend_at', v_now + interval '60 seconds');
end;
$$;

create function public.auth_otp_verify(p_email_key text, p_purpose text, p_challenge_id uuid, p_code_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare challenge public.auth_otp_challenges;
begin
  select * into challenge from public.auth_otp_challenges where id = p_challenge_id and email_key = p_email_key and purpose = p_purpose for update;
  if not found or challenge.consumed or challenge.expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'error', 'This code has expired or is no longer valid. Request a new code.', 'attempts_remaining', 0);
  end if;
  update public.auth_otp_challenges set attempts = attempts + 1,
    consumed = (code_hash = p_code_hash or attempts + 1 >= 3) where id = p_challenge_id;
  if challenge.code_hash <> p_code_hash then
    return jsonb_build_object('ok', false, 'error', case when challenge.attempts + 1 >= 3 then 'No attempts left. Request a new code.' else 'Incorrect code. Try again.' end, 'attempts_remaining', 2 - challenge.attempts);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.auth_otp_find_user(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.auth_otp_issue(text, text, text, uuid, text), public.auth_otp_verify(text, text, uuid, text), public.auth_otp_find_user(text) from public, anon, authenticated;
grant execute on function public.auth_otp_issue(text, text, text, uuid, text), public.auth_otp_verify(text, text, uuid, text), public.auth_otp_find_user(text) to service_role;
