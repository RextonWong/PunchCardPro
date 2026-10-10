import { createClient } from '@supabase/supabase-js';

// Project URL and anon key are safe to expose in the browser.
// Row Level Security on the database enforces access control.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://lpfxlrqrllpvlkmarham.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwZnhscnFybGxwdmxrbWFyaGFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjgwNjcsImV4cCI6MjA5MjI0NDA2N30.0s2c8_4TdjY6Lw7vhdA36coDUNkyUbOGlDAZ8sha2bo';

export const isLocalSupabase = ['localhost', '127.0.0.1'].includes(new URL(SUPABASE_URL).hostname);
if (import.meta.env.MODE === 'sandbox' && (!isLocalSupabase || !import.meta.env.VITE_SUPABASE_ANON_KEY)) {
  throw new Error('Sandbox requires a local Supabase URL and its local anon key. See docs/fix-export-auth-layout.md.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
