-- Kundprisavtal och kundgrupper: grupprabatt, kundspecifika nettopriser och volymrabatt per artikel med giltighetstid
CREATE TABLE IF NOT EXISTS customer_groups (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct < 100),
  UNIQUE (company_id, name)
);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_group_id integer REFERENCES customer_groups(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS price_agreements (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id integer REFERENCES customers(id) ON DELETE CASCADE,
  group_id integer REFERENCES customer_groups(id) ON DELETE CASCADE,
  product_id integer NOT NULL, -- inv_products (lagermodulens tabell skapas efter kärnans migreringar)
  net_price bigint CHECK (net_price >= 0),
  discount_pct numeric(5,2) CHECK (discount_pct > 0 AND discount_pct < 100),
  min_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  valid_from date NOT NULL,
  valid_to date,
  created_by integer REFERENCES users(id),
  CHECK ((customer_id IS NULL) <> (group_id IS NULL)),
  CHECK ((net_price IS NULL) <> (discount_pct IS NULL)),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS price_agreements_lookup ON price_agreements (company_id, product_id);
