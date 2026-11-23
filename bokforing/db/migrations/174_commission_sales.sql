-- Kommissionsförsäljning: varor som säljs i eget namn för huvudmäns räkning, provisionen är intäkt, resten skuld till huvudmannen; avräkningsnotor och utbetalning
CREATE TABLE IF NOT EXISTS commission_principals (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  vat_registered boolean NOT NULL DEFAULT false,
  commission_pct numeric(5,2) NOT NULL CHECK (commission_pct > 0 AND commission_pct < 100),
  bank_account text NOT NULL DEFAULT '',
  UNIQUE (company_id, name)
);
CREATE TABLE IF NOT EXISTS commission_settlements (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  principal_id integer NOT NULL REFERENCES commission_principals(id) ON DELETE CASCADE,
  date date NOT NULL,
  amount bigint NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS commission_items (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  principal_id integer NOT NULL REFERENCES commission_principals(id) ON DELETE CASCADE,
  description text NOT NULL,
  ask_price bigint, -- begärt pris inkl. moms
  vat_rate integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0,6,12,25)),
  received_on date NOT NULL,
  status text NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','sold','returned')),
  sold_on date,
  sale_price bigint, -- exkl. moms
  sale_vat bigint,
  commission bigint,
  principal_share bigint, -- exkl. moms
  principal_vat bigint, -- huvudmannens moms om huvudmannen är momsregistrerad
  voucher_id integer REFERENCES vouchers(id),
  settlement_id integer REFERENCES commission_settlements(id) ON DELETE SET NULL,
  returned_on date,
  created_by integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS commission_items_principal ON commission_items (company_id, principal_id, status);
