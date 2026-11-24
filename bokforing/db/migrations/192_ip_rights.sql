-- Immateriella rättigheter: varumärken, patent och domäner med förnyelse, kostnader som kostnadsförs eller aktiveras
CREATE TABLE IF NOT EXISTS ip_rights (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('trademark', 'patent', 'domain', 'design', 'other')),
  name text NOT NULL,
  registration_no text NOT NULL DEFAULT '',
  registry text NOT NULL DEFAULT '',
  territory text NOT NULL DEFAULT '',
  registered_on date,
  renewal_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'lapsed')),
  lapsed_on date,
  note text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ip_rights_company ON ip_rights (company_id);
CREATE TABLE IF NOT EXISTS ip_costs (
  id serial PRIMARY KEY,
  ip_id integer NOT NULL REFERENCES ip_rights(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('application', 'renewal', 'legal', 'acquisition')),
  amount bigint NOT NULL CHECK (amount > 0),
  treatment text NOT NULL CHECK (treatment IN ('expensed', 'capitalized')),
  account integer NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  asset_id integer REFERENCES assets(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id)
);
