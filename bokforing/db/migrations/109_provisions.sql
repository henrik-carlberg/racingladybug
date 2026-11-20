-- Avsättningar (22xx) med rörelser och register över ställda säkerheter och eventualförpliktelser
CREATE TABLE IF NOT EXISTS provisions (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('warranty','restructuring','dispute','other')),
  description text NOT NULL,
  account integer NOT NULL CHECK (account BETWEEN 2200 AND 2299),
  cost_account integer NOT NULL CHECK (cost_account BETWEEN 4000 AND 7999),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provision_movements (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provision_id integer NOT NULL REFERENCES provisions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('set','use','release')),
  date date NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provision_movements_p ON provision_movements (provision_id, date);
CREATE TABLE IF NOT EXISTS commitments (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('business_mortgage','property_mortgage','pledged_asset','guarantee','other_contingent')),
  description text NOT NULL,
  beneficiary text NOT NULL DEFAULT '',
  amount bigint NOT NULL CHECK (amount > 0),
  from_date date NOT NULL,
  to_date date,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
