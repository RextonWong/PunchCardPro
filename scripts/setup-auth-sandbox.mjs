import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const status = JSON.parse(execSync('npx supabase status --output json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const url = new URL(status.API_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || !status.ANON_KEY) throw new Error('A running local Supabase sandbox is required.');
writeFileSync('.env.sandbox.local', `VITE_SUPABASE_URL=${status.API_URL}\nVITE_SUPABASE_ANON_KEY=${status.ANON_KEY}\n`);
console.log('Configured the local sandbox in the ignored .env.sandbox.local file. Run npm run dev:sandbox.');
