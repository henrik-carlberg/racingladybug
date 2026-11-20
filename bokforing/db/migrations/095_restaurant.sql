-- Hotell och restaurang: personalmåltider per anställd och månad (kostförmån och uttagsmoms)
CREATE TABLE staff_meals (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period      text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  employee_id integer REFERENCES employees(id) ON DELETE SET NULL,
  name        text NOT NULL,
  breakfasts  integer NOT NULL DEFAULT 0 CHECK (breakfasts >= 0),
  lunches     integer NOT NULL DEFAULT 0 CHECK (lunches >= 0),
  dinners     integer NOT NULL DEFAULT 0 CHECK (dinners >= 0),
  paid        bigint NOT NULL DEFAULT 0 CHECK (paid >= 0),
  value       bigint NOT NULL,
  taxable     bigint NOT NULL,
  vat         bigint NOT NULL,
  voucher_id  integer REFERENCES vouchers(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_meals_period ON staff_meals (company_id, period);
