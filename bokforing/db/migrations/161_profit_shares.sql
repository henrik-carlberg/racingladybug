-- Tantiem och vinstdelning till anställda: upplupen lön vid bokslut, utbetalning via lönekörningen
CREATE TABLE IF NOT EXISTS profit_share_plans (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('percent','target')),
  pct integer CHECK (pct IS NULL OR (pct > 0 AND pct <= 5000)),
  target bigint,
  amount bigint CHECK (amount IS NULL OR amount > 0),
  cap bigint CHECK (cap IS NULL OR cap > 0),
  note text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'percent' AND pct IS NOT NULL) OR (kind = 'target' AND target IS NOT NULL AND amount IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS profit_share_accruals (
  id serial PRIMARY KEY,
  plan_id integer NOT NULL REFERENCES profit_share_plans(id) ON DELETE CASCADE,
  fiscal_year_id integer NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  amount bigint NOT NULL,
  fee bigint NOT NULL,
  payout_run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
  reversal_voucher_id integer REFERENCES vouchers(id),
  UNIQUE (plan_id, fiscal_year_id)
);
CREATE TABLE IF NOT EXISTS profit_share_vouchers (
  id serial PRIMARY KEY,
  accrual_id integer NOT NULL REFERENCES profit_share_accruals(id) ON DELETE CASCADE,
  amount bigint NOT NULL, fee bigint NOT NULL,
  voucher_id integer NOT NULL REFERENCES vouchers(id)
);
