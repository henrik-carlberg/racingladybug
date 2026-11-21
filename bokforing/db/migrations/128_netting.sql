-- Kvittningar mellan kund- och leverantörsfakturor
CREATE TABLE IF NOT EXISTS offsets (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  orgnr text NOT NULL,
  date date NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  pairs jsonb NOT NULL,
  agreement text NOT NULL DEFAULT '',
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
