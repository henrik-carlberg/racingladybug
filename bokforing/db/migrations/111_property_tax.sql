-- Fastigheter för fastighetsskatt och skattemässiga avskrivningar
CREATE TABLE IF NOT EXISTS tax_properties (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  designation text NOT NULL,
  type text NOT NULL CHECK (type IN ('bostad','lokal','industri','tomt')),
  tax_value bigint NOT NULL DEFAULT 0 CHECK (tax_value >= 0),
  apartments integer NOT NULL DEFAULT 0 CHECK (apartments >= 0),
  cap_per_apartment bigint NOT NULL DEFAULT 0 CHECK (cap_per_apartment >= 0),
  value_year integer,
  acquired date NOT NULL,
  building_cost bigint NOT NULL DEFAULT 0 CHECK (building_cost >= 0),
  building_rate numeric(4,2) NOT NULL DEFAULT 4 CHECK (building_rate BETWEEN 0 AND 5),
  improvement_cost bigint NOT NULL DEFAULT 0 CHECK (improvement_cost >= 0),
  land_cost bigint NOT NULL DEFAULT 0 CHECK (land_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, designation)
);
CREATE TABLE IF NOT EXISTS property_tax_postings (
  property_id integer NOT NULL REFERENCES tax_properties(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount bigint NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  PRIMARY KEY (property_id, period)
);
