-- Lönekartläggning: kravnivå för likvärdigt arbete och dokumenterad analys av skillnader per grupp och år
CREATE TABLE IF NOT EXISTS pay_survey_levels (
  employee_id integer PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_level integer NOT NULL CHECK (job_level BETWEEN 1 AND 6)
);
CREATE TABLE IF NOT EXISTS pay_survey_analyses (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('equal', 'equivalent')),
  group_key text NOT NULL,
  objective boolean NOT NULL,
  cause text NOT NULL,
  action text NOT NULL DEFAULT '',
  due_date date,
  created_by integer REFERENCES users(id),
  PRIMARY KEY (company_id, year, kind, group_key)
);
