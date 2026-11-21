-- Vinstmarginalbeskattning, förenklad metod: avräkning per period med negativ marginal som förs vidare
CREATE TABLE IF NOT EXISTS vmb_settlements (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_from date NOT NULL,
  period_to date NOT NULL CHECK (period_to >= period_from),
  sales bigint NOT NULL,
  purchases bigint NOT NULL,
  carried_in bigint NOT NULL DEFAULT 0,
  margin bigint NOT NULL,
  vat bigint NOT NULL,
  carry_out bigint NOT NULL DEFAULT 0,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
