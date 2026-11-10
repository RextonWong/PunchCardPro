import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

const inputClass = 'mt-1 w-full border border-slate-300 bg-white p-3 text-sm outline-none focus:border-blue-600';
const labelClass = 'block text-xs font-bold uppercase tracking-wide text-slate-600';

export default function Settings({ session, settings, settingsLoaded, settingsError, dataReady, workplaces, onSave, onDownloadData, onBack, preview = false }) {
  const [draft, setDraft] = useState(settings);
  const [email, setEmail] = useState(session.user.email || '');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setDraft(settings); }, [settings]);
  useEffect(() => { setEmail(session.user.email || ''); }, [session.user.email]);

  const savePreferences = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!draft.companyName.trim()) {
      setError('Company name is required for spreadsheet exports.');
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setMessage('Settings saved.');
    } catch (saveError) {
      setError(saveError.message || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const updateEmail = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const nextEmail = email.trim();
    if (nextEmail === session.user.email) return;
    setAccountBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ email: nextEmail });
      if (updateError) throw updateError;
      setMessage('Email change requested. Check your inbox if confirmation is required.');
    } catch (updateError) {
      setError(updateError.message || 'Could not change email.');
    } finally {
      setAccountBusy(false);
    }
  };

  const updatePassword = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password !== passwordConfirm) {
      setError('Passwords do not match.');
      return;
    }
    setAccountBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword('');
      setPasswordConfirm('');
      setMessage('Password updated.');
    } catch (updateError) {
      setError(updateError.message || 'Could not change password.');
    } finally {
      setAccountBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 pb-16 font-sans text-slate-700 sm:p-6">
      <main className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 pb-4">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tight">Settings</h1>
            <p className="text-sm text-slate-500">Account, preferences, and spreadsheet exports</p>
          </div>
          <button type="button" onClick={onBack} className="border border-blue-300 bg-white px-4 py-2 text-xs font-bold uppercase text-blue-700 hover:bg-blue-50">← Dashboard</button>
        </div>

        {preview && <p role="status" className="border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">Local preview: settings can be explored, but account changes and saving are disabled.</p>}

        {error && <p role="alert" className="border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {settingsError && <p role="alert" className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{settingsError}</p>}
        {message && <p role="status" className="border border-green-200 bg-green-50 p-3 text-sm text-green-800">{message}</p>}

        <section className="space-y-5 border bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-lg font-black uppercase">Account</h2>
          <form onSubmit={updateEmail} className="grid gap-3 border-t pt-5 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className={labelClass}>Email address
              <input type="email" required disabled={preview} value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
            </label>
            <button type="submit" disabled={preview || accountBusy || email.trim() === session.user.email} className="min-h-11 bg-blue-600 px-5 text-xs font-bold uppercase text-white disabled:opacity-50">Change email</button>
          </form>
          <form onSubmit={updatePassword} className="grid gap-3 border-t pt-5 sm:grid-cols-2">
            <label className={labelClass}>New password
              <input type="password" required disabled={preview} minLength={6} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} />
            </label>
            <label className={labelClass}>Confirm new password
              <input type="password" required disabled={preview} minLength={6} autoComplete="new-password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} className={inputClass} />
            </label>
            <button type="submit" disabled={preview || accountBusy} className="min-h-11 bg-blue-600 px-5 text-xs font-bold uppercase text-white disabled:opacity-50 sm:justify-self-start">Change password</button>
          </form>
          <button type="button" disabled={preview} onClick={() => supabase.auth.signOut()} className="border border-slate-300 px-4 py-2 text-xs font-bold uppercase hover:border-red-400 hover:text-red-700 disabled:opacity-50">Sign out</button>
        </section>

        <form onSubmit={savePreferences} className="space-y-6">
          <section className="space-y-5 border bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-lg font-black uppercase">Preferences</h2>
            <label className={labelClass}>Display name
              <input maxLength={100} value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>Default site after sign-in
              <select value={draft.defaultSiteId || ''} onChange={(event) => setDraft({ ...draft, defaultSiteId: event.target.value || null })} className={inputClass}>
                <option value="">Dashboard</option>
                {draft.defaultSiteId && !workplaces.some((site) => site.id === draft.defaultSiteId) && (
                  <option value={draft.defaultSiteId}>Unavailable site — choose another</option>
                )}
                {workplaces.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
              </select>
            </label>
          </section>

          <section className="space-y-5 border bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-lg font-black uppercase">Spreadsheet export</h2>
            <label className={labelClass}>Company heading
              <input required maxLength={100} value={draft.companyName} onChange={(event) => setDraft({ ...draft, companyName: event.target.value })} className={inputClass} />
            </label>
            <fieldset className="space-y-3 border-t pt-5">
              <legend className="text-xs font-bold uppercase tracking-wide text-slate-600">Lorry layout</legend>
              <label className="flex gap-3 text-sm"><input type="radio" name="export-layout" checked={draft.exportLayout === 'separate'} onChange={() => setDraft({ ...draft, exportLayout: 'separate' })} />Separate tab for each lorry</label>
              <label className="flex gap-3 text-sm"><input type="radio" name="export-layout" checked={draft.exportLayout === 'combined'} onChange={() => setDraft({ ...draft, exportLayout: 'combined' })} />All lorries on one tab, stacked vertically</label>
            </fieldset>
            <label className="flex gap-3 border-t pt-5 text-sm"><input type="checkbox" checked={draft.includeEmptyDays} onChange={(event) => setDraft({ ...draft, includeEmptyDays: event.target.checked })} />Include days without entries</label>
            <label className="flex gap-3 text-sm"><input type="checkbox" checked={draft.includeSummary} onChange={(event) => setDraft({ ...draft, includeSummary: event.target.checked })} />Include lorry totals summary</label>
            <p className="text-xs text-slate-500">With one lorry tab, the summary appears above the lorry tables. With separate tabs, it has its own tab.</p>
          </section>
          <button type="submit" disabled={preview || saving || !settingsLoaded} className="min-h-11 bg-green-700 px-6 text-xs font-bold uppercase text-white hover:bg-green-800 disabled:opacity-50">{saving ? 'Saving…' : 'Save settings'}</button>
        </form>

        <section className="space-y-3 border bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-lg font-black uppercase">Data</h2>
          <p className="text-sm text-slate-600">Download a JSON backup of your sites, ledger entries, and settings. Account credentials are excluded.</p>
          <button type="button" disabled={preview || !dataReady} onClick={onDownloadData} className="border border-blue-700 bg-white px-4 py-2 text-xs font-bold uppercase text-blue-700 hover:bg-blue-50 disabled:opacity-50">Download all data</button>
          {!preview && !dataReady && <p className="text-xs text-red-700">Reload the page after the saved data loads successfully to download a complete backup.</p>}
        </section>
      </main>
    </div>
  );
}
