-- ============================================================
-- PunchCard Pro — Core Schema
-- Creates the two primary tables that replace localStorage.
--
-- Data model summary:
--   workplaces  →  site configurations (rate, rest windows, rain rule)
--   entries     →  one row per lorry per shift day per site
--
-- Fleet (lorry ID list) is derived at query time with:
--   SELECT DISTINCT lori_id FROM entries WHERE workplace_id = $1
-- so no separate fleet table is needed.
-- ============================================================


-- ============================================================
-- TABLE: workplaces
--
-- Stores each construction/logistics site and all of its
-- payroll configuration:
--   • rate       — RM charged per billable hour
--   • rain_min   — minimum guaranteed hours when is_rain = true
--   • l_*        — Mon–Thu lunch break window + deduction threshold
--   • f_*        — Friday (Jumaat) prayer break window + threshold
--
-- Rest is only deducted when clock-out time >= the threshold,
-- so short shifts are not penalised by the lunch/prayer break.
-- ============================================================
CREATE TABLE workplaces (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,

  -- Billing rate in Malaysian Ringgit per billable hour
  rate        NUMERIC(10, 2) NOT NULL DEFAULT 80,

  -- Rain-day guarantee: billable hours cannot fall below this value
  rain_min    NUMERIC(4, 1)  NOT NULL DEFAULT 4.0,

  -- Monday–Thursday lunch window (24-hour HH:MM format)
  l_start     TIME        NOT NULL DEFAULT '13:00',
  l_end       TIME        NOT NULL DEFAULT '14:00',
  -- Rest is deducted only when clock-out is on or after this time
  l_threshold TIME        NOT NULL DEFAULT '14:30',

  -- Friday Jumaat prayer window — separate from regular lunch
  f_start     TIME        NOT NULL DEFAULT '12:00',
  f_end       TIME        NOT NULL DEFAULT '13:30',
  -- Same threshold logic as l_threshold but applied on Fridays
  f_threshold TIME        NOT NULL DEFAULT '15:30',

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- TABLE: entries
--
-- One row per lorry per day per site. Calculated payroll values
-- (hours, rest, total) are stored denormalised so that ledger
-- reads and Excel exports never need to re-run the math engine.
--
-- time_range stores the raw "HHMM-HHMM" string (e.g. "0800-1900")
-- exactly as the app produces it, so the frontend can split and
-- display it without any conversion.
--
-- The UNIQUE constraint on (workplace_id, lori_id, date) prevents
-- duplicate entries being posted for the same lorry on the same day.
-- ============================================================
CREATE TABLE entries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cascade-delete entries when their parent site is removed
  workplace_id UUID        NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,

  -- Lorry identifier as typed by the admin (e.g. "LD", "LD2", "ABC123")
  lori_id      TEXT        NOT NULL,

  -- The calendar date of the shift
  date         DATE        NOT NULL,

  -- Raw clock-in/clock-out string kept for display ("0800-1900")
  time_range   TEXT        NOT NULL,

  -- Billable hours after 30-minute rounding and rest deduction
  hours        NUMERIC(5, 2) NOT NULL,

  -- Hours removed for lunch or Friday prayer (0 if threshold not met)
  rest         NUMERIC(5, 2) NOT NULL DEFAULT 0,

  -- Pre-computed fee: hours × site rate at time of entry
  total        NUMERIC(10, 2) NOT NULL,

  -- Rain day flag — when true, hours is floored to site rain_min
  is_rain      BOOLEAN     NOT NULL DEFAULT FALSE,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Block duplicate posts for the same lorry on the same day at the same site
  UNIQUE (workplace_id, lori_id, date)
);


-- ============================================================
-- INDEXES
--
-- Most reads filter by workplace_id first, then narrow by date
-- (monthly ledger view) or lori_id (lorry tab). These three
-- indexes cover those access patterns efficiently.
-- ============================================================

-- Base index — used whenever any query targets a specific site
CREATE INDEX idx_entries_workplace
  ON entries (workplace_id);

-- Used by the monthly ledger view (WHERE workplace_id = $1 AND date LIKE 'YYYY-MM-%')
CREATE INDEX idx_entries_workplace_date
  ON entries (workplace_id, date);

-- Used by the lorry tab filter (WHERE workplace_id = $1 AND lori_id = $2)
CREATE INDEX idx_entries_workplace_lori
  ON entries (workplace_id, lori_id);


-- ============================================================
-- ROW LEVEL SECURITY (RLS)
--
-- RLS is enabled on both tables as a security baseline.
-- The current policies grant full access to the `anon` role
-- because user authentication has not been implemented yet.
--
-- TODO: Once auth is added, replace these open policies with
-- user-scoped rules (e.g. each workplace belongs to an owner,
-- and only that owner's JWT can read/write it).
-- ============================================================
ALTER TABLE workplaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries    ENABLE ROW LEVEL SECURITY;

-- Temporary open policy — remove when auth is implemented
CREATE POLICY "anon_all_workplaces"
  ON workplaces FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- Temporary open policy — remove when auth is implemented
CREATE POLICY "anon_all_entries"
  ON entries FOR ALL TO anon
  USING (true) WITH CHECK (true);
