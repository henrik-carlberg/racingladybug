-- Körjournal per fordon: företagets bilar och ägarens egen bil i enskild firma. Årsavräkning: avdrag för egen bil i tjänst eller uttag för privat körning med företagets bil.
CREATE TABLE IF NOT EXISTS vehicles (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reg_no text NOT NULL,
  name text NOT NULL DEFAULT '',
  owner text NOT NULL CHECK (owner IN ('company','private')),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, reg_no)
);
CREATE TABLE IF NOT EXISTS vehicle_trips (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vehicle_id integer NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  date date NOT NULL,
  from_place text NOT NULL DEFAULT '',
  to_place text NOT NULL DEFAULT '',
  purpose text NOT NULL DEFAULT '',
  km numeric(10,1) NOT NULL CHECK (km > 0),
  odo_start integer,
  odo_end integer,
  private boolean NOT NULL DEFAULT false,
  customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_trips_vehicle ON vehicle_trips (vehicle_id, date);
CREATE TABLE IF NOT EXISTS vehicle_settlements (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vehicle_id integer NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  year integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('mileage_deduction','private_use')),
  km numeric(10,1) NOT NULL,
  rate bigint NOT NULL, -- öre per mil
  amount bigint NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  UNIQUE (vehicle_id, year, kind)
);
