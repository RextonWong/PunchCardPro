import { lazy, Suspense } from 'react';
import App from './App';
const Admin = lazy(() => import('./Admin'));
export default function Root() {
  return <Suspense fallback={<p className="p-6">Loading…</p>}>
    {window.location.pathname.replace(/\/$/, '') === '/admin' ? <Admin /> : <App />}
  </Suspense>;
}
