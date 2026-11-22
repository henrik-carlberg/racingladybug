-- Kassainventeringar av kontantkassan
CREATE TABLE IF NOT EXISTS cash_counts (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  counted bigint NOT NULL CHECK (counted >= 0),
  booked bigint NOT NULL,
  diff bigint NOT NULL,
  counted_by text NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
