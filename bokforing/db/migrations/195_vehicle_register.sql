-- Fordonsregister: besiktning, försäkring, skatt, service och däck för bolagets fordon samt kostnader per fordon
CREATE TABLE IF NOT EXISTS vehicle_details (
  vehicle_id integer PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  model text NOT NULL DEFAULT '',
  model_year integer,
  fuel text NOT NULL DEFAULT '',
  inspection_due date,
  insurance_until date,
  service_due_date date,
  service_due_km integer,
  asset_id integer REFERENCES assets(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS vehicle_events (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vehicle_id integer NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('fuel', 'service', 'repair', 'inspection', 'tax', 'insurance', 'tyres', 'other')),
  amount bigint NOT NULL DEFAULT 0 CHECK (amount >= 0), -- exkl. moms
  vat bigint NOT NULL DEFAULT 0 CHECK (vat >= 0),
  odometer integer,
  note text NOT NULL DEFAULT '',
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS vehicle_events_vehicle ON vehicle_events (vehicle_id, date);
