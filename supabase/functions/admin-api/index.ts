import { createClient } from 'npm:@supabase/supabase-js@2.106.1';
import { handleAdmin } from './handler.mjs';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(req => handleAdmin(req, db));
