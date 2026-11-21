-- Expertskatt och SINK: beslut per anställd och den skattefria delen på lönespecen
CREATE TABLE IF NOT EXISTS employee_special_tax (
  employee_id integer PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('expert','sink')),
  decision text NOT NULL DEFAULT '',
  valid_from date NOT NULL,
  valid_to date NOT NULL,
  updated_by integer REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS tax_kind text NOT NULL DEFAULT 'normal' CHECK (tax_kind IN ('normal','expert','sink'));
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS tax_exempt_cash bigint NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS tax_exempt_benefits bigint NOT NULL DEFAULT 0;
