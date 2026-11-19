-- Kollektivavtal (OB, övertid, beredskap, semestertillägg), pensionsplaner och löneväxling
CREATE TABLE collective_agreements (
  id                          serial PRIMARY KEY,
  company_id                  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                        text NOT NULL,
  ob_evening                  bigint NOT NULL DEFAULT 0,
  ob_night                    bigint NOT NULL DEFAULT 0,
  ob_weekend                  bigint NOT NULL DEFAULT 0,
  ob_holiday                  bigint NOT NULL DEFAULT 0,
  overtime_simple_divisor     integer NOT NULL DEFAULT 94,
  overtime_qualified_divisor  integer NOT NULL DEFAULT 72,
  oncall_weekday              bigint NOT NULL DEFAULT 0,
  oncall_weekend              bigint NOT NULL DEFAULT 0,
  vacation_supplement         numeric(5,2) NOT NULL DEFAULT 0.43,
  fora_insurance_percent      numeric(5,3) NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
ALTER TABLE employees ADD COLUMN agreement_id integer REFERENCES collective_agreements(id) ON DELETE SET NULL;
ALTER TABLE employees ADD COLUMN pension_plan text NOT NULL DEFAULT 'custom' CHECK (pension_plan IN ('custom','itp1','itp2','saf_lo'));
ALTER TABLE employees ADD COLUMN salary_sacrifice bigint NOT NULL DEFAULT 0;     -- löneväxling, öre per månad
ALTER TABLE payslips ADD COLUMN hours jsonb NOT NULL DEFAULT '{}';               -- timmar för OB, övertid och beredskap
ALTER TABLE payslips ADD COLUMN insurance bigint NOT NULL DEFAULT 0;             -- avtalsförsäkringar (Fora)
