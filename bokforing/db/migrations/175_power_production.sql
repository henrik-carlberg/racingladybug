-- Egen elproduktion: anläggningar (t.ex. solceller), producerad och såld el per månad, elcertifikat och ursprungsgarantier, underlag för skattereduktion för mikroproduktion
CREATE TABLE IF NOT EXISTS power_plants (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'sol' CHECK (kind IN ('sol','vind','vatten','annan')),
  capacity_kw numeric(10,2),
  investment bigint NOT NULL DEFAULT 0 CHECK (investment >= 0),
  asset_id integer REFERENCES assets(id) ON DELETE SET NULL,
  start_date date NOT NULL,
  UNIQUE (company_id, name)
);
CREATE TABLE IF NOT EXISTS power_months (
  id serial PRIMARY KEY,
  plant_id integer NOT NULL REFERENCES power_plants(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  produced_kwh numeric(12,1) NOT NULL CHECK (produced_kwh >= 0),
  sold_kwh numeric(12,1) NOT NULL CHECK (sold_kwh >= 0),
  bought_kwh numeric(12,1) NOT NULL DEFAULT 0 CHECK (bought_kwh >= 0),
  sold_amount bigint NOT NULL DEFAULT 0 CHECK (sold_amount >= 0), -- exkl. moms
  vat_rate integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0,25)),
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  UNIQUE (plant_id, period),
  CHECK (sold_kwh <= produced_kwh)
);
CREATE TABLE IF NOT EXISTS power_certificates (
  id serial PRIMARY KEY,
  plant_id integer NOT NULL REFERENCES power_plants(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('elcert','guarantee')),
  quantity integer NOT NULL CHECK (quantity > 0),
  amount bigint NOT NULL CHECK (amount > 0), -- exkl. moms
  vat_rate integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0,25)),
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id)
);
