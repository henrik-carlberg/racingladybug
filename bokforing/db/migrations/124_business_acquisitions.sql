-- Förvärv av rörelse (inkråmsköp)
CREATE TABLE IF NOT EXISTS business_acquisitions (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  seller text NOT NULL,
  date date NOT NULL,
  price bigint NOT NULL CHECK (price > 0),
  items jsonb NOT NULL,
  goodwill bigint NOT NULL,
  agreement text NOT NULL DEFAULT '',
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
