-- Försäkringsersättningar och ersättningsfonder
CREATE TABLE IF NOT EXISTS insurance_claims (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  description text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('inventarier','byggnad')),
  damage_date date NOT NULL,
  asset_account integer NOT NULL CHECK (asset_account BETWEEN 1000 AND 1299),
  book_value bigint NOT NULL CHECK (book_value >= 0),
  compensation bigint NOT NULL CHECK (compensation > 0),
  damage_voucher_id integer REFERENCES vouchers(id),
  fund bigint NOT NULL DEFAULT 0,
  fund_year integer,
  used bigint NOT NULL DEFAULT 0,
  reversed bigint NOT NULL DEFAULT 0,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
