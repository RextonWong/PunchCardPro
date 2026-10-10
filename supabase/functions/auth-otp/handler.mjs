const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const codeLifetime = 300;

async function digest(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function localSandbox(url) {
  const parsed = new URL(url);
  return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', 'kong'].includes(parsed.hostname);
}

export function randomCode() {
  // Rejection sampling avoids modulo bias in the six-digit code space.
  const bytes = new Uint32Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= 4294000000);
  return String(bytes[0] % 1000000).padStart(6, '0');
}

export function createOtpHandler({ store, auth, sendEmail, secret, isSandbox, allowedOrigins }) {
  return async (request) => {
    const origin = request.headers.get('origin');
    const cors = origin && allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } : {};
    const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...cors, ...(body.retry_after ? { 'Retry-After': String(body.retry_after) } : {}) } });
    if (origin && !allowedOrigins.includes(origin)) return respond({ error: 'This origin is not allowed.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return respond({ error: 'Use POST.' }, 405);

    try {
      const bodyText = await request.text();
      if (bodyText.length > 8192) return respond({ error: 'Request is too large.' }, 413);
      let body;
      try { body = JSON.parse(bodyText); } catch { return respond({ error: 'Invalid request.' }, 400); }
      if (!body || Array.isArray(body) || typeof body !== 'object') return respond({ error: 'Invalid request.' }, 400);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond({ error: 'Enter a valid email address.' }, 400);
      if (!['signup', 'recovery'].includes(body.purpose)) return respond({ error: 'Invalid verification purpose.' }, 400);
      const emailKey = await digest(secret, `email:${email}`);

      if (body.action === 'request') {
        const challengeId = crypto.randomUUID();
        const code = isSandbox ? '123321' : randomCode();
        const codeHash = await digest(secret, `code:${emailKey}:${body.purpose}:${challengeId}:${code}`);
        const ip = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown';
        const ipKey = await digest(secret, `ip:${ip}`);
        const issued = await store.issue({ emailKey, ipKey, purpose: body.purpose, challengeId, codeHash });
        if (!issued.ok) return respond({ error: issued.error, retry_after: issued.retry_after }, 429);
        const userId = await auth.findUser(email);
        const shouldSend = body.purpose === 'signup' ? !userId : Boolean(userId);
        if (shouldSend) await sendEmail({ email, code, purpose: body.purpose });
        return respond({ challenge_id: challengeId, expires_at: issued.expires_at, resend_at: issued.resend_at, expires_in: codeLifetime, message: 'If this address is eligible, a verification code has been sent.' });
      }

      if (body.action !== 'verify') return respond({ error: 'Invalid verification action.' }, 400);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.challenge_id || '') || !/^\d{6}$/.test(body.code || '')) return respond({ error: 'Enter the six-digit code.' }, 400);
      if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) return respond({ error: 'Use a password of 12 to 128 characters.' }, 400);
      const codeHash = await digest(secret, `code:${emailKey}:${body.purpose}:${body.challenge_id}:${body.code}`);
      const verified = await store.verify({ emailKey, purpose: body.purpose, challengeId: body.challenge_id, codeHash });
      if (!verified.ok) return respond({ error: verified.error, attempts_remaining: verified.attempts_remaining }, 400);
      if (body.purpose === 'signup') {
        await auth.createUser(email, body.password);
        return respond({ message: 'Email verified. Your account is ready. Sign in to continue.' });
      }
      const userId = await auth.findUser(email);
      if (!userId) return respond({ error: 'Unable to reset this account. Request a new code.' }, 400);
      await auth.resetPassword(userId, email, body.password);
      return respond({ message: 'Password changed. Your existing sessions have been signed out. Sign in with your new password.' });
    } catch (error) {
      // Never log email addresses, codes, passwords, provider responses, or request bodies.
      console.error('auth-otp operation failed', error?.name || 'Error');
      if (error?.name === 'PasswordResetSessionsError') return respond({ error: 'Your password was changed, but other sessions could not be signed out. Sign in with your new password, then use Sign Out to close them.' }, 503);
      return respond({ error: 'Unable to complete this request. Please try again later or request a new code.' }, 503);
    }
  };
}
