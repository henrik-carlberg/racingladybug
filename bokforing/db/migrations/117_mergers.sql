-- Fusion av helägt dotterbolag
CREATE TABLE IF NOT EXISTS mergers (
  subsidiary_company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  parent_company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_date date NOT NULL,
  registered_on date,
  net_assets bigint,
  share_value bigint,
  difference bigint,
  treatment text CHECK (treatment IN ('equity','goodwill')),
  parent_voucher_id integer REFERENCES vouchers(id),
  subsidiary_voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_company_id <> subsidiary_company_id)
);
