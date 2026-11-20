-- Leasing: avtalsregister, klassning (operationell/finansiell), bokade betalningar
CREATE TABLE leasing_contracts (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('car','machine','it','premises','other')),
  lessor         text NOT NULL DEFAULT '',
  start_date     date NOT NULL,
  months         integer NOT NULL CHECK (months BETWEEN 1 AND 360),
  fee            bigint NOT NULL CHECK (fee > 0),          -- månadsavgift exkl. moms
  vat_rate       integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 6, 12, 25)),
  residual       bigint NOT NULL DEFAULT 0 CHECK (residual >= 0),
  rate_pct       numeric(6,3) NOT NULL DEFAULT 0 CHECK (rate_pct >= 0 AND rate_pct < 100),
  fair_value     bigint,
  life_months    integer,
  transfer       boolean NOT NULL DEFAULT false,           -- äganderätten övergår
  treatment      text NOT NULL DEFAULT 'operational' CHECK (treatment IN ('operational','financial')),
  bank_account   integer NOT NULL DEFAULT 1930,
  pv             bigint,
  asset_id       integer REFERENCES assets(id) ON DELETE SET NULL,
  start_voucher_id integer REFERENCES vouchers(id) ON DELETE SET NULL,
  ended_on       date,
  created_by     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leasing_contracts_company ON leasing_contracts (company_id);
CREATE TABLE leasing_postings (
  contract_id    integer NOT NULL REFERENCES leasing_contracts(id) ON DELETE CASCADE,
  period         text NOT NULL,
  voucher_id     integer REFERENCES vouchers(id) ON DELETE SET NULL,
  PRIMARY KEY (contract_id, period)
);
