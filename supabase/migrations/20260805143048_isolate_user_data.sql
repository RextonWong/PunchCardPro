-- Isolate every workplace and its ledger entries by Supabase Auth user.
--
-- This project originally used a shared-company data model where every
-- authenticated account could access every row. During this migration, the
-- existing shared dataset is assigned to the oldest registered non-anonymous
-- account, which is the original account in the legacy single-owner model.

-- The production schema already has this column and its policies. Keep the
-- migration safe to apply when recording it in migration history there.
ALTER TABLE public.workplaces
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Preserve the existing single-owner dataset during the tenancy migration.
UPDATE public.workplaces
SET owner_id = (
  SELECT id
  FROM auth.users
  WHERE COALESCE(is_anonymous, FALSE) = FALSE
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE owner_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.workplaces WHERE owner_id IS NULL) THEN
    RAISE EXCEPTION
      'Cannot isolate existing workplaces: no registered owner account was found';
  END IF;
END
$$;

ALTER TABLE public.workplaces
  ALTER COLUMN owner_id SET DEFAULT auth.uid(),
  ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workplaces_owner
  ON public.workplaces (owner_id);

-- Remove every previous policy, including any permissive policy that may have
-- been added manually, before installing the account-scoped policy set.
DO $$
DECLARE
  existing_policy RECORD;
BEGIN
  FOR existing_policy IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('workplaces', 'entries')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      existing_policy.policyname,
      existing_policy.tablename
    );
  END LOOP;
END
$$;

ALTER TABLE public.workplaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;

-- Workplaces: users can only access rows carrying their own immutable owner ID.
CREATE POLICY "workplaces_select_own"
  ON public.workplaces FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = owner_id);

CREATE POLICY "workplaces_insert_own"
  ON public.workplaces FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id);

CREATE POLICY "workplaces_update_own"
  ON public.workplaces FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = owner_id)
  WITH CHECK ((SELECT auth.uid()) = owner_id);

CREATE POLICY "workplaces_delete_own"
  ON public.workplaces FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = owner_id);

-- Entries inherit ownership through their parent workplace. This prevents a
-- user from reading another account's ledger or attaching entries to its site.
CREATE POLICY "entries_select_own_workplace"
  ON public.entries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workplaces AS workplace
      WHERE workplace.id = entries.workplace_id
        AND workplace.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "entries_insert_own_workplace"
  ON public.entries FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workplaces AS workplace
      WHERE workplace.id = entries.workplace_id
        AND workplace.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "entries_update_own_workplace"
  ON public.entries FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workplaces AS workplace
      WHERE workplace.id = entries.workplace_id
        AND workplace.owner_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workplaces AS workplace
      WHERE workplace.id = entries.workplace_id
        AND workplace.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "entries_delete_own_workplace"
  ON public.entries FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workplaces AS workplace
      WHERE workplace.id = entries.workplace_id
        AND workplace.owner_id = (SELECT auth.uid())
    )
  );
