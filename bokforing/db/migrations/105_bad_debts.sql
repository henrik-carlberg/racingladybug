-- Kundförluster: konstaterade (fakturan skrivs bort och momsen sätts ned) och reserv för befarade vid bokslut
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('draft','booked','paid','credited','written_off'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS written_off_amount bigint NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS written_off_voucher_id integer REFERENCES vouchers(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS written_off_date date;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS written_off_reason text NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recovered_amount bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS bad_debt_reserves (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_id integer NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  target bigint NOT NULL,
  change bigint NOT NULL,
  invoice_ids integer[] NOT NULL DEFAULT '{}',
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bad_debt_reserves_fy ON bad_debt_reserves (company_id, fiscal_year_id);
