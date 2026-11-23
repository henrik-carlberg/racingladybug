-- Lojalitetsprogram: medlemmar tjänar poäng på fakturerade köp, poängen löses in som rabatt eller förfaller; skulden för utestående poäng (förutbetald intäkt) justeras vid periodens slut
CREATE TABLE IF NOT EXISTS loyalty_settings (
  company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  kr_per_point numeric(10,2) NOT NULL DEFAULT 10 CHECK (kr_per_point > 0), -- köp exkl. moms per intjänad poäng
  point_value numeric(10,2) NOT NULL DEFAULT 10 CHECK (point_value > 0), -- öre per poäng vid inlösen
  redemption_rate integer NOT NULL DEFAULT 80 CHECK (redemption_rate BETWEEN 0 AND 100), -- förväntad andel som löses in, %
  expiry_months integer NOT NULL DEFAULT 24 CHECK (expiry_months BETWEEN 1 AND 120),
  start_date date NOT NULL DEFAULT CURRENT_DATE
);
CREATE TABLE IF NOT EXISTS loyalty_members (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  joined_on date NOT NULL,
  PRIMARY KEY (company_id, customer_id)
);
CREATE TABLE IF NOT EXISTS loyalty_points (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('earn','redeem','expire')),
  points integer NOT NULL CHECK (points > 0),
  invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_points_earn_once ON loyalty_points (invoice_id) WHERE kind = 'earn';
CREATE INDEX IF NOT EXISTS loyalty_points_customer ON loyalty_points (company_id, customer_id, date);
CREATE TABLE IF NOT EXISTS loyalty_accruals (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  liability bigint NOT NULL,
  change bigint NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id)
);
