-- Lantbruk: EU-stöd och ersättningar som fordran för det år de avser, och djurinventering som värderas per djurslag med bokförd lagerförändring
CREATE TABLE IF NOT EXISTS farm_subsidies (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL,
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  applied bigint NOT NULL CHECK (applied > 0),
  booked bigint NOT NULL DEFAULT 0, -- bokförd fordran
  paid bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','booked','paid')),
  booked_voucher_id integer REFERENCES vouchers(id),
  paid_voucher_id integer REFERENCES vouchers(id),
  paid_on date,
  created_by integer REFERENCES users(id),
  UNIQUE (company_id, kind, year)
);
CREATE TABLE IF NOT EXISTS livestock_types (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  value_per_head bigint NOT NULL CHECK (value_per_head >= 0),
  UNIQUE (company_id, name)
);
CREATE TABLE IF NOT EXISTS livestock_valuations (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  counts jsonb NOT NULL, -- [{type, heads, value_per_head, value}]
  value bigint NOT NULL,
  change bigint NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  UNIQUE (company_id, date)
);
