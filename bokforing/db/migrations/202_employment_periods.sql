-- Anställningsperioder för LAS: särskild visstid och vikariat som övergår till tillsvidareanställning, företrädesrätt och turordning
CREATE TABLE IF NOT EXISTS employment_periods (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  form text NOT NULL CHECK (form IN ('sav', 'vikariat', 'provanstallning', 'tillsvidare', 'other')),
  start_date date NOT NULL,
  end_date date,
  circle text NOT NULL DEFAULT '',
  shortage boolean NOT NULL DEFAULT false, -- avslutad på grund av arbetsbrist
  created_by integer REFERENCES users(id),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS employment_periods_employee ON employment_periods (employee_id, start_date);
CREATE TABLE IF NOT EXISTS las_exemptions (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, employee_id)
);
