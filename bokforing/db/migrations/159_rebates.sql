-- Bonusavtal i efterhand (kundbonus och leverantörsbonus) med trappsteg på volymen
CREATE TABLE IF NOT EXISTS rebate_agreements (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('customer','supplier')),
  customer_id integer REFERENCES customers(id) ON DELETE CASCADE,
  supplier_id integer REFERENCES suppliers(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date),
  tiers jsonb NOT NULL,
  vat_rate integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 6, 12, 25)),
  note text NOT NULL DEFAULT '',
  settled_amount bigint,
  settled_at date,
  settled_invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
  settled_voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'customer' AND customer_id IS NOT NULL AND supplier_id IS NULL) OR (kind = 'supplier' AND supplier_id IS NOT NULL AND customer_id IS NULL))
);
CREATE INDEX IF NOT EXISTS rebate_agreements_company ON rebate_agreements (company_id, kind);
-- Upplupen bonus vid bokslut (kumulativt belopp per räkenskapsår)
CREATE TABLE IF NOT EXISTS rebate_accruals (
  id serial PRIMARY KEY,
  agreement_id integer NOT NULL REFERENCES rebate_agreements(id) ON DELETE CASCADE,
  fiscal_year_id integer NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  amount bigint NOT NULL,
  voucher_id integer NOT NULL REFERENCES vouchers(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rebate_accruals_agreement ON rebate_accruals (agreement_id);
