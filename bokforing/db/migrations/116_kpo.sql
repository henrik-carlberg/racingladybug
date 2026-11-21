-- Kvalificerade personaloptioner: program, tilldelningar och utnyttjande
CREATE TABLE IF NOT EXISTS kpo_programs (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  decided_on date NOT NULL,
  started_year integer NOT NULL,
  excluded_business boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kpo_grants (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  program_id integer NOT NULL REFERENCES kpo_programs(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id),
  granted_on date NOT NULL,
  options integer NOT NULL CHECK (options > 0),
  strike bigint NOT NULL CHECK (strike >= 0),
  share_value bigint NOT NULL CHECK (share_value >= 0),
  premium bigint NOT NULL DEFAULT 0,
  hours_per_week numeric(5,2) NOT NULL,
  exercised_on date,
  exercised_count integer,
  market_price bigint,
  qualified boolean,
  benefit bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
