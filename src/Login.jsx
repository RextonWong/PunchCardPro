import React, { useState } from 'react';
import { supabase } from './supabaseClient';

function Login() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error,    setError]    = useState('');
  const [message,  setMessage]  = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else {
        // Supabase may require email confirmation depending on project settings.
        // If the user doesn't receive a confirmation email, disable "Confirm email"
        // in the Supabase dashboard → Authentication → Providers → Email.
        setMessage('Account created! Check your email to confirm, then sign in.');
        setIsSignUp(false);
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
      <div className="bg-white border w-full max-w-md p-12 shadow-sm">

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
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@company.com"
              className="w-full border p-3 outline-none focus:border-blue-600 text-sm"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full border p-3 outline-none focus:border-blue-600 text-sm"
            />
          </div>

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
          onClick={() => { setIsSignUp(!isSignUp); setError(''); setMessage(''); }}
          className="mt-6 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-blue-600 w-full text-center transition-colors"
        >
          {isSignUp ? 'Already have an account? Sign In' : "No account? Create one"}
        </button>

      </div>
    </div>
  );
}

export default Login;
