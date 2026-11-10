CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT 'LAND VISION TRADING',
  export_layout TEXT NOT NULL DEFAULT 'separate' CHECK (export_layout IN ('separate', 'combined')),
  include_empty_days BOOLEAN NOT NULL DEFAULT TRUE,
  include_summary BOOLEAN NOT NULL DEFAULT FALSE,
  default_site_id UUID REFERENCES public.workplaces(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT display_name_length CHECK (char_length(display_name) <= 100),
  CONSTRAINT company_name_length CHECK (char_length(company_name) BETWEEN 1 AND 100)
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_settings_select_own"
  ON public.user_settings FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "user_settings_insert_own"
  ON public.user_settings FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (
      default_site_id IS NULL OR EXISTS (
        SELECT 1 FROM public.workplaces
        WHERE id = default_site_id AND owner_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY "user_settings_update_own"
  ON public.user_settings FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (
      default_site_id IS NULL OR EXISTS (
        SELECT 1 FROM public.workplaces
        WHERE id = default_site_id AND owner_id = (SELECT auth.uid())
      )
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.user_settings TO authenticated;
