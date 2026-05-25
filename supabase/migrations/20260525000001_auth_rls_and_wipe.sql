-- ============================================================
-- Migration: Lock down RLS to authenticated users + wipe data
--
-- Previously the anon role had full access (no auth existed).
-- Now that Supabase Auth is wired up, only logged-in users
-- should be able to read or write data.
-- ============================================================

-- Drop the temporary open policies from the initial migration
DROP POLICY IF EXISTS "anon_all_workplaces" ON workplaces;
DROP POLICY IF EXISTS "anon_all_entries"    ON entries;

-- All authenticated users share the same data.
-- Suitable for the single shared-account model — one set of
-- credentials for the whole company, all admins see everything.
CREATE POLICY "auth_all_workplaces"
  ON workplaces FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_entries"
  ON entries FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Wipe existing data so the app starts clean under the new auth model.
-- CASCADE handles the foreign key from entries → workplaces automatically.
TRUNCATE TABLE workplaces CASCADE;
