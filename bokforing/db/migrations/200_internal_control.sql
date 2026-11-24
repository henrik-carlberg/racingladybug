-- Internkontroll: riskregister med sannolikhet och konsekvens, kontroller med frekvens och ansvarig, logg över utförda kontroller
CREATE TABLE IF NOT EXISTS ic_risks (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  area text NOT NULL,
  description text NOT NULL,
  likelihood integer NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  impact integer NOT NULL CHECK (impact BETWEEN 1 AND 5),
  owner text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS ic_controls (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  risk_id integer REFERENCES ic_risks(id) ON DELETE SET NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('attest', 'reconciliation', 'access_review', 'segregation', 'other')),
  frequency text NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
  owner text NOT NULL DEFAULT '',
  start_period text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS ic_runs (
  id serial PRIMARY KEY,
  control_id integer NOT NULL REFERENCES ic_controls(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period text NOT NULL,
  performed_on date NOT NULL,
  ok boolean NOT NULL,
  deviation text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id),
  UNIQUE (control_id, period)
);
