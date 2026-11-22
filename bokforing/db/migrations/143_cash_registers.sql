-- Kassaregister med anmäld kontrollenhet och X-rapporter
CREATE TABLE IF NOT EXISTS cash_registers (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  control_unit text NOT NULL,
  registered_on date NOT NULL,
  skv_reference text NOT NULL DEFAULT '',
  open_days integer[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id),
  UNIQUE (company_id, name)
);
CREATE TABLE IF NOT EXISTS cash_x_reports (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  register text NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  amount bigint NOT NULL CHECK (amount >= 0),
  note text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id)
);
