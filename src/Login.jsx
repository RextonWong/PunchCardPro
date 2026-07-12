import React, { useState } from 'react';
import { supabase } from './supabaseClient';

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
function PasswordField({ label, value, onChange, placeholder = '••••••••' }) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">{label}</label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          required
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full border p-3 pr-10 outline-none focus:border-blue-600 text-sm"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
          tabIndex={-1}
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
  const [isSignUp, setIsSignUp] = useState(false);
  const [error,    setError]    = useState('');
  const [message,  setMessage]  = useState('');
  const [loading,  setLoading]  = useState(false);

  const switchMode = (toSignUp) => {
    setIsSignUp(toSignUp);
    setError('');
    setMessage('');
    setPassword('');
    setConfirm('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (isSignUp && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else {
        setMessage('Account created! You can now sign in.');
        switchMode(false);
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      // On success, onAuthStateChange in App.jsx updates the session automatically.
      if (error) setError(error.message);
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans">
      <div className="bg-white border w-full max-w-md p-6 sm:p-12 shadow-sm">

        <div className="mb-10">
          <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-800">
            PunchCard Pro
          </h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-2">
            {isSignUp ? 'Create Account' : 'Sign In to Continue'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@company.com"
              className="w-full border p-3 outline-none focus:border-blue-600 text-sm"
            />
          </div>

          <PasswordField
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {/* Confirm password only shown during sign-up */}
          {isSignUp && (
            <PasswordField
              label="Confirm Password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
            />
          )}

          {error   && <p className="text-xs text-red-500 font-bold">{error}</p>}
          {message && <p className="text-xs text-green-600 font-bold">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-4 font-bold uppercase text-xs tracking-widest shadow disabled:opacity-50"
          >
            {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <button
          onClick={() => switchMode(!isSignUp)}
          className="mt-6 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-blue-600 w-full text-center transition-colors"
        >
          {isSignUp ? 'Already have an account? Sign In' : 'No account? Create one'}
        </button>

      </div>
    </div>
  );
}

export default Login;
