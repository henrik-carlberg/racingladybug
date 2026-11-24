-- Försäkringsöversikt: bolagets försäkringar med premie, period, självrisk och täckning, premien periodiseras från förutbetalda kostnader, förnyelsepåminnelse
CREATE TABLE IF NOT EXISTS insurance_policies (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  insurer text NOT NULL,
  kind text NOT NULL,
  policy_no text NOT NULL DEFAULT '',
  premium bigint NOT NULL CHECK (premium > 0), -- årspremie för perioden, öre
  start_date date NOT NULL,
  end_date date NOT NULL,
  deductible bigint NOT NULL DEFAULT 0 CHECK (deductible >= 0),
  coverage text NOT NULL DEFAULT '',
  recognized bigint NOT NULL DEFAULT 0, -- kostnadsfört från 1790
  prepaid_voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  CHECK (end_date > start_date)
);
