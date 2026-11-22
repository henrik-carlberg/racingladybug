-- Presentkort (enfunktions- och flerfunktionsvoucher)
CREATE TABLE IF NOT EXISTS gift_cards (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('single','multi')),
  vat_rate integer NOT NULL CHECK (vat_rate IN (6, 12, 25)),
  amount bigint NOT NULL CHECK (amount > 0),
  redeemed bigint NOT NULL DEFAULT 0 CHECK (redeemed >= 0),
  sold_on date NOT NULL,
  valid_to date NOT NULL,
  expired_on date,
  created_by integer REFERENCES users(id),
  UNIQUE (company_id, code),
  CHECK (redeemed <= amount)
);
