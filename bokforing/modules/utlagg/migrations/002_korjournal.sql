-- Körjournal och utbetalning av utlägg via banken
CREATE TABLE exp_trips (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id  integer NOT NULL REFERENCES employees(id),
  date         date NOT NULL,
  from_place   text NOT NULL,
  to_place     text NOT NULL,
  purpose      text NOT NULL,
  km           numeric(10,1) NOT NULL CHECK (km > 0),
  odo_start    integer,
  odo_end      integer,
  vehicle      text NOT NULL CHECK (vehicle IN ('private','company')),
  line_id      integer REFERENCES exp_lines(id) ON DELETE SET NULL,
  created_by   integer NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exp_trips_emp ON exp_trips(company_id, employee_id, date);

ALTER TABLE bank_payments DROP CONSTRAINT bank_payments_kind_check;
ALTER TABLE bank_payments ADD CONSTRAINT bank_payments_kind_check CHECK (kind IN ('supplier','salary','expense'));
ALTER TABLE bank_payments ADD COLUMN expense_claim_id integer REFERENCES exp_claims(id) ON DELETE SET NULL;
