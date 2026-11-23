-- Uppsägning och avgångsvederlag: uppsägningstid enligt LAS, sista anställningsdag, arbetsbefrielse, avgångsvederlag som engångsbelopp, skuld för uppsägningslön och avgångsvederlag
CREATE TABLE IF NOT EXISTS terminations (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  initiated_by text NOT NULL CHECK (initiated_by IN ('employer','employee')),
  notice_date date NOT NULL,
  notice_months integer NOT NULL CHECK (notice_months BETWEEN 0 AND 24),
  last_day date NOT NULL,
  garden_leave boolean NOT NULL DEFAULT false, -- arbetsbefriad under uppsägningstiden
  severance bigint NOT NULL DEFAULT 0 CHECK (severance >= 0), -- avgångsvederlag brutto
  severance_tax_pct numeric(5,2) NOT NULL DEFAULT 30,
  accrued bigint NOT NULL DEFAULT 0, -- bokförd skuld inkl. arbetsgivaravgifter
  accrual_voucher_id integer REFERENCES vouchers(id),
  release_voucher_id integer REFERENCES vouchers(id),
  status text NOT NULL DEFAULT 'notice' CHECK (status IN ('notice','ended')),
  created_by integer REFERENCES users(id),
  UNIQUE (employee_id)
);
