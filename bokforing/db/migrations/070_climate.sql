-- Klimatbokföring: egna faktorer per kategori och exakta mängder (kWh, liter)
CREATE TABLE climate_factors (
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key         text NOT NULL,
  factor      numeric(10,4) NOT NULL CHECK (factor >= 0),
  PRIMARY KEY (company_id, key)
);
CREATE TABLE climate_activities (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date        date NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('electricity_kwh','district_heat_kwh','petrol_l','diesel_l')),
  quantity    numeric(14,2) NOT NULL CHECK (quantity > 0),
  note        text NOT NULL DEFAULT '',
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX climate_activities_company ON climate_activities (company_id, date);
