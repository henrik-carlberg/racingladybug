-- Sanktionsavgifter och böter: ej avdragsgilla kostnader (6992/8423), sammanställning för skattemässig justering och granskning av felkonterade avgifter
CREATE TABLE IF NOT EXISTS penalties (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL,
  authority text NOT NULL DEFAULT '',
  reference text NOT NULL DEFAULT '',
  date date NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  account integer NOT NULL,
  credit_account integer NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS penalties_company ON penalties (company_id, date);
-- Granskade verifikationsrader som såg ut som sanktionsavgifter på avdragsgilla konton
CREATE TABLE IF NOT EXISTS penalty_reviews (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  voucher_id integer NOT NULL REFERENCES vouchers(id),
  account integer NOT NULL,
  action text NOT NULL CHECK (action IN ('reclassed', 'ignored')),
  reclass_voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  PRIMARY KEY (voucher_id, account)
);
