-- Koncernkonto (cash pool): huvudkonto i moderbolaget, underkonton i dotterbolagen, överföringar och månadsvis internränta som bokförs i båda bolagen
CREATE TABLE IF NOT EXISTS cash_pools (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE, -- huvudkontots bolag (moderbolaget)
  name text NOT NULL,
  bank_account integer NOT NULL DEFAULT 1930,
  deposit_rate numeric(6,3) NOT NULL DEFAULT 0 CHECK (deposit_rate >= 0 AND deposit_rate < 50), -- % per år till bolag med positivt saldo
  borrow_rate numeric(6,3) NOT NULL DEFAULT 0 CHECK (borrow_rate >= 0 AND borrow_rate < 50), -- % per år från bolag med negativt saldo
  created_by integer REFERENCES users(id),
  UNIQUE (company_id, name)
);
CREATE TABLE IF NOT EXISTS cash_pool_members (
  pool_id integer NOT NULL REFERENCES cash_pools(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account integer NOT NULL DEFAULT 1930,
  PRIMARY KEY (pool_id, company_id)
);
CREATE TABLE IF NOT EXISTS cash_pool_transfers (
  id serial PRIMARY KEY,
  pool_id integer NOT NULL REFERENCES cash_pools(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sweep','interest')),
  amount bigint NOT NULL CHECK (amount <> 0), -- positivt = bolagets fordran på huvudkontot ökar
  period text,
  member_voucher_id integer REFERENCES vouchers(id),
  master_voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_pool_transfers_member ON cash_pool_transfers (pool_id, company_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS cash_pool_interest_once ON cash_pool_transfers (pool_id, company_id, period) WHERE kind = 'interest';
