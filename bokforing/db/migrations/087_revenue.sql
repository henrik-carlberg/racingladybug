-- Abonnemangsintäkter: tjänsteperiod på fakturan, periodisering via förutbetalda intäkter och intäktsplan per månad
ALTER TABLE invoices ADD COLUMN service_from date;
ALTER TABLE invoices ADD COLUMN service_to date;
CREATE TABLE invoice_deferrals (
  invoice_id   integer PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  voucher_id   integer REFERENCES vouchers(id) ON DELETE SET NULL,
  deferred     bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE revenue_schedules (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id   integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  customer_id  integer NOT NULL REFERENCES customers(id),
  account      integer NOT NULL,
  period       text NOT NULL,
  amount       bigint NOT NULL,
  posted       boolean NOT NULL DEFAULT false,
  voucher_id   integer REFERENCES vouchers(id) ON DELETE SET NULL
);
CREATE INDEX revenue_schedules_due ON revenue_schedules (company_id, period) WHERE NOT posted;
CREATE INDEX revenue_schedules_customer ON revenue_schedules (company_id, customer_id, period);
