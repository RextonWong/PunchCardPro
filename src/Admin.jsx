import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import Login from './Login';

async function request(body) {
  const { data, error } = await supabase.functions.invoke('admin-api', { body });
  if (error) {
    let message = 'Could not reach the admin service.';
    try { message = (await error.context.json()).error || message; } catch { /* Network failure has no response body. */ }
    throw new Error(message);
  }
  return data;
}
const date = value => value ? new Date(value).toLocaleString() : 'Never';

export default function Admin() {
  const [session, setSession] = useState(undefined);
  const [users, setUsers] = useState([]), [total, setTotal] = useState(0);
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [days, setDays] = useState(30), [page, setPage] = useState(1);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(null), [events, setEvents] = useState([]);
  const version = useRef(0);
  const dialog = useRef(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, current) => {
      version.current++; setUsers([]); setTotal(0); setEvents([]); setTarget(null); setBusy(false); setSession(current);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const load = useCallback(async () => {
    const current = ++version.current;
    setBusy(true); setError('');
    try {
      const result = await request({ action: 'users', search: query, page, days });
      if (current === version.current) { setUsers(result.users); setTotal(result.total); }
    } catch (e) { if (current === version.current) { setUsers([]); setError(e.message); } }
    finally { if (current === version.current) setBusy(false); }
  }, [query, page, days]);
  useEffect(() => { if (session) load(); }, [session, load]);
  useEffect(() => {
    if (!target) return;
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => { previous?.focus(); };
  }, [target]);
  if (session === undefined) return <p className="p-6">Checking sign-in…</p>;
  if (!session) return <Login />;
  const changeAccount = async () => {
    setBusy(true); setError('');
    try {
      await request({ action: target.suspended ? 'restore' : 'suspend', userId: target.id });
      setTarget(null); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-slate-100 p-4 md:p-8 text-slate-800">
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-3xl font-bold">Administration</h1><p className="text-sm text-slate-500">Users, scanning usage and account controls</p></div><a href="/" className="self-center underline">Back to dashboard</a></header>
      <p className="rounded border border-blue-200 bg-blue-50 p-3 text-sm">Usage starts when tracking is deployed. Costs are estimates in USD, not invoices. Unpriced attempts are excluded from the known cost subtotal.</p>
      <form className="flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search); }}>
        <label className="flex-1 min-w-48">Search email<input value={search} onChange={e => setSearch(e.target.value)} className="block w-full rounded border bg-white p-3" /></label>
        <label>Usage period<select value={days} onChange={e => { setDays(Number(e.target.value)); setPage(1); }} className="block rounded border bg-white p-3"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label>
        <button disabled={busy} className="self-end rounded bg-blue-700 px-5 py-3 text-white disabled:opacity-50">Search</button>
      </form>
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-4">{error}</p>}
      {busy && <p role="status">Loading…</p>}
      {!busy && !error && <p>{total} {total === 1 ? 'user' : 'users'}</p>}
      <section className="grid gap-4 md:grid-cols-2" aria-label="User accounts">
        {users.map(u => <article key={u.id} className="min-w-0 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="break-all text-lg font-bold">{u.email}</h2><p className="text-sm">{u.is_admin ? 'Administrator' : u.suspended ? 'Suspended' : 'Active'} · {u.email_confirmed_at ? 'Email verified' : 'Email unverified'}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-slate-500">Registered</dt><dd>{date(u.created_at)}</dd></div><div><dt className="text-slate-500">Last sign-in</dt><dd>{date(u.last_sign_in_at)}</dd></div>
            <div><dt className="text-slate-500">Scan requests / API attempts</dt><dd>{u.usage.requests} / {u.usage.attempts}</dd></div><div><dt className="text-slate-500">Failed API attempts</dt><dd>{u.usage.errors}</dd></div>
            <div><dt className="text-slate-500">Input / output tokens</dt><dd>{u.usage.input_tokens} / {u.usage.output_tokens}</dd></div><div><dt className="text-slate-500">Known cost subtotal</dt><dd>${Number(u.usage.estimated_usd).toFixed(4)} · {u.usage.unpriced} unpriced</dd></div>
          </dl><p className="mt-3 break-all text-xs text-slate-500">Models: {u.usage.models.join(', ') || 'No recorded usage'}</p>
          {!u.is_admin && <button disabled={busy} onClick={() => setTarget(u)} className="mt-4 min-h-11 rounded border px-4 text-sm font-bold">{u.suspended ? 'Restore account' : 'Suspend account'}</button>}
        </article>)}
      </section>
      <nav className="flex items-center gap-4" aria-label="User pages"><button disabled={busy || page === 1} onClick={() => setPage(page-1)} className="rounded border p-3 disabled:opacity-40">Previous</button><span>Page {page}</span><button disabled={busy || page*25 >= total} onClick={() => setPage(page+1)} className="rounded border p-3 disabled:opacity-40">Next</button></nav>
      <button className="rounded border p-3" disabled={busy} onClick={async () => { const current = version.current; try { const result = await request({ action: 'audit' }); if (current === version.current) setEvents(result.events); } catch (e) { if (current === version.current) setError(e.message); } }}>Show recent admin actions</button>
      <ul className="space-y-2 text-sm">{events.map(e => <li key={e.id} className="break-all rounded border bg-white p-3">{date(e.created_at)} · {e.action} · target {e.target_id} · administrator {e.actor_id}</li>)}</ul>
      {target && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><dialog ref={dialog} onCancel={e => { e.preventDefault(); if (!busy) setTarget(null); }} aria-labelledby="account-action-title" className="m-auto w-full max-w-md rounded-xl bg-white p-6 backdrop:bg-black/40"><h2 id="account-action-title" className="text-xl font-bold">{target.suspended ? 'Restore' : 'Suspend'} account?</h2><p className="my-4 break-all">{target.email}</p><p className="mb-5 text-sm">{target.suspended ? 'The user can access their saved data and scan again.' : 'Saved data is retained. The user will lose access to data and scanning. Previously downloaded data cannot be withdrawn.'}</p><div className="flex gap-3"><button disabled={busy} onClick={changeAccount} className="rounded bg-blue-700 p-3 text-white">Confirm {target.suspended ? 'restore' : 'suspend'}</button><button disabled={busy} onClick={() => setTarget(null)} className="rounded border p-3">Cancel</button></div></dialog></div>}
    </div>
  </main>;
}
