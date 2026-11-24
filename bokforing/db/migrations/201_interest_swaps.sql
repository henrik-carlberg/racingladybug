-- Räntesäkring: ränteswappar (betala fast, ta emot rörligt) kopplade till lån, avräkning per period och marknadsvärde i bokslutet
CREATE TABLE IF NOT EXISTS interest_swaps (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  loan_id integer REFERENCES loans(id) ON DELETE SET NULL,
  counterparty text NOT NULL,
  notional bigint NOT NULL CHECK (notional > 0),
  fixed_rate numeric(6,3) NOT NULL CHECK (fixed_rate >= -5 AND fixed_rate < 50),
  floating_index text NOT NULL DEFAULT 'STIBOR 3M',
  start_date date NOT NULL,
  end_date date NOT NULL,
  period_months integer NOT NULL DEFAULT 3 CHECK (period_months IN (1, 3, 6, 12)),
  created_by integer REFERENCES users(id),
  CHECK (end_date > start_date)
);
CREATE TABLE IF NOT EXISTS swap_settlements (
  id serial PRIMARY KEY,
  swap_id integer NOT NULL REFERENCES interest_swaps(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  floating_rate numeric(6,3) NOT NULL,
  amount bigint NOT NULL, -- positivt = bolaget får betalt
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  UNIQUE (swap_id, period_start)
);
CREATE TABLE IF NOT EXISTS swap_valuations (
  swap_id integer NOT NULL REFERENCES interest_swaps(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  market_value bigint NOT NULL,
  PRIMARY KEY (swap_id, date)
);
