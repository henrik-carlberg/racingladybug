-- Moms på djupet: proportionering i blandad verksamhet, jämkning av investeringsvaror och VIES-kontroll av kunder
ALTER TABLE companies ADD COLUMN vat_deduction_pct numeric(5,2) CHECK (vat_deduction_pct >= 0 AND vat_deduction_pct <= 100),
  ADD COLUMN common_cost_accounts integer[] NOT NULL DEFAULT '{}';
CREATE TABLE vat_proportion_runs (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_from    date NOT NULL,
  period_to      date NOT NULL,
  pct            numeric(5,2) NOT NULL,
  common_vat     bigint NOT NULL,
  non_deductible bigint NOT NULL,
  voucher_id     integer REFERENCES vouchers(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_from)
);
CREATE TABLE vat_investments (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  description    text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('fastighet','inventarie')),
  completed_on   date NOT NULL,
  vat_amount     bigint NOT NULL CHECK (vat_amount > 0),
  orig_pct       numeric(5,2) NOT NULL CHECK (orig_pct >= 0 AND orig_pct <= 100),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vat_adjustments (
  investment_id  integer NOT NULL REFERENCES vat_investments(id) ON DELETE CASCADE,
  year           integer NOT NULL,
  new_pct        numeric(5,2) NOT NULL,
  amount         bigint NOT NULL,
  voucher_id     integer REFERENCES vouchers(id) ON DELETE SET NULL,
  PRIMARY KEY (investment_id, year)
);
ALTER TABLE customers ADD COLUMN vies_valid boolean, ADD COLUMN vies_name text NOT NULL DEFAULT '', ADD COLUMN vies_checked_at timestamptz;
