-- Utbildning och behörigheter: kurser och certifikat per anställd med giltighetstid, kostnad på 7610 och förmånsbedömning
CREATE TABLE IF NOT EXISTS trainings (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('course', 'certificate')),
  provider text NOT NULL DEFAULT '',
  completed_on date NOT NULL,
  valid_until date,
  cost bigint NOT NULL DEFAULT 0 CHECK (cost >= 0),
  work_related boolean NOT NULL DEFAULT true,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS trainings_company ON trainings (company_id, employee_id);
