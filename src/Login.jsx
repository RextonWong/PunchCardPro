import React, { useEffect, useId, useState } from 'react';
import { isLocalSupabase, supabase } from './supabaseClient';
import { LegalLinks } from './LegalNotices';

// Eye icons as inline SVG — no icon library needed
const EyeOpen = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const EyeClosed = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.477 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
  </svg>
);

// Password input with a show/hide toggle button
function PasswordField({ label, value, onChange, isNew = false, placeholder = '••••••••' }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-[10px] font-bold uppercase text-slate-400 block mb-1">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required
          autoComplete={isNew ? 'new-password' : 'current-password'}
          minLength={isNew ? 12 : undefined}
          maxLength={128}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full border p-3 pr-12 outline-none focus:border-blue-600 text-base sm:text-sm"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          {visible ? <EyeClosed /> : <EyeOpen />}
        </button>
      </div>
    </div>
  );
}

function Login() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [mode, setMode] = useState('signin');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [attemptsRemaining, setAttemptsRemaining] = useState(3);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [error,    setError]    = useState('');
  const [message,  setMessage]  = useState('');
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    if (!challenge && !retryAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [challenge, retryAt]);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setMessage('');
    setPassword('');
    setConfirm('');
    setCode('');
    setChallenge(null);
    setAttemptsRemaining(3);
    setRetryAt(0);
  };

  const invokeOtp = async (body) => {
    const { data, error: invokeError } = await supabase.functions.invoke('auth-otp', { body });
    if (!invokeError) return data;
    let details;
    try { details = await invokeError.context?.json(); } catch { /* Network failures have no JSON response. */ }
    if (details?.retry_after) setRetryAt(Date.now() + details.retry_after * 1000);
    if (typeof details?.attempts_remaining === 'number') setAttemptsRemaining(details.attempts_remaining);
    throw new Error(details?.error || 'Could not reach verification. Check your connection and try again.');
  };

  const requestCode = async () => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const data = await invokeOtp({ action: 'request', purpose: mode === 'signup' ? 'signup' : 'recovery', email });
      setChallenge(data);
      setAttemptsRemaining(3);
      setCode('');
      setRetryAt(new Date(data.resend_at).getTime());
      setNow(Date.now());
      setMessage(data.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (mode !== 'signin' && (mode === 'signup' || challenge) && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    if (mode !== 'signin' && !challenge) {
      await requestCode();
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (signInError) throw signInError;
      } else {
        const data = await invokeOtp({ action: 'verify', purpose: mode === 'signup' ? 'signup' : 'recovery', email, challenge_id: challenge.challenge_id, code, password });
        switchMode('signin');
        setMessage(data.message);
      }
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  };

  const remainingSeconds = challenge ? Math.max(0, Math.ceil((new Date(challenge.expires_at).getTime() - now) / 1000)) : 0;
  const resendSeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const cannotVerify = challenge && (!remainingSeconds || !attemptsRemaining);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col p-4 pb-28 md:pb-16 font-sans">
      <div className="flex flex-1 items-center justify-center">
        <div className="bg-white border w-full max-w-md p-6 sm:p-12 shadow-sm">

        <div className="mb-10">
          <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-800">
            PunchCard Pro
          </h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-2">
            {mode === 'signup' ? 'Create Account' : mode === 'recovery' ? 'Reset Password' : 'Sign In to Continue'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="auth-email" className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Email</label>
            <input
              id="auth-email"
              type="email"
              required
              autoComplete="email"
              readOnly={Boolean(challenge)}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@company.com"
              className="w-full border p-3 outline-none focus:border-blue-600 text-base sm:text-sm"
            />
          </div>

          {(mode !== 'recovery' || challenge) && <PasswordField
            label={mode === 'recovery' ? 'New Password' : 'Password'}
            isNew={mode !== 'signin'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />}

          {/* Confirm password only shown during sign-up */}
          {(mode === 'signup' || (mode === 'recovery' && challenge)) && (
            <PasswordField
              label="Confirm Password"
              isNew
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
            />
          )}

          {mode !== 'signin' && <p className="text-xs text-slate-500">Use a unique password of at least 12 characters. Codes expire in 5 minutes with 3 attempts. You can request up to 5 codes before a one-hour cooldown.</p>}
          {challenge && <div className="space-y-2">
            <label htmlFor="auth-code" className="block text-xs font-bold uppercase text-slate-500">Verification code</label>
            <input id="auth-code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} className="w-full border p-3 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-blue-600" />
            <p role="status" className="text-xs text-slate-600">{remainingSeconds ? `Expires in ${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')} · ${attemptsRemaining} attempts remaining` : 'Code expired. Request a new code.'}</p>
            {isLocalSupabase && <p className="text-xs font-bold text-amber-700">Local sandbox code: 123321</p>}
            <button type="button" onClick={requestCode} disabled={loading || resendSeconds > 0} className="min-h-11 w-full border px-3 text-sm font-bold text-blue-700 disabled:opacity-50">{resendSeconds ? `Resend available in ${resendSeconds}s` : 'Send a new code'}</button>
          </div>}

          {error   && <p role="alert" className="text-xs text-red-600 font-bold">{error}</p>}
          {message && <p role="status" className="text-xs text-green-700 font-bold">{message}</p>}

          <button
            type="submit"
            disabled={loading || Boolean(cannotVerify) || (!challenge && mode !== 'signin' && resendSeconds > 0)}
            className="w-full border border-blue-700 bg-blue-600 text-white py-4 font-bold uppercase text-xs tracking-widest hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Please wait...' : mode === 'signin' ? 'Sign In' : !challenge ? 'Send verification code' : mode === 'signup' ? 'Verify & Create Account' : 'Verify & Reset Password'}
          </button>
        </form>

        <button
          type="button"
          disabled={loading}
          onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
          className="mt-6 w-full border border-slate-300 bg-white px-4 py-2 text-center text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:border-blue-400 hover:text-blue-700 transition-colors"
        >
          {mode !== 'signin' ? 'Back to Sign In' : 'No account? Create one'}
        </button>

        {mode === 'signin' && <button type="button" disabled={loading} onClick={() => switchMode('recovery')} className="mt-3 min-h-11 w-full text-sm font-bold text-blue-700 underline">Forgot password?</button>}

        </div>
      </div>
      <LegalLinks />
    </div>
  );
}

export default Login;
