-- Försäkringsskador: anmälan, försäkringsbolagets besked (värdering och självrisk) och utbetalning. Skadad tillgång utrangeras, förstört lager skrivs bort.
CREATE TABLE IF NOT EXISTS damage_claims (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('asset','inventory','other')),
  description text NOT NULL,
  damage_date date NOT NULL,
  insurer text NOT NULL DEFAULT '',
  claim_ref text NOT NULL DEFAULT '',
  asset_id integer REFERENCES assets(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','assessed','paid','denied')),
  written_off bigint NOT NULL DEFAULT 0, -- bokfört värde som utrangerats eller skrivits bort ur lagret
  assessed bigint, -- skadan enligt försäkringsbolagets värdering
  deductible bigint,
  compensation bigint,
  report_voucher_id integer REFERENCES vouchers(id),
  assessment_voucher_id integer REFERENCES vouchers(id),
  payment_voucher_id integer REFERENCES vouchers(id),
  fund_claim_id integer REFERENCES insurance_claims(id) ON DELETE SET NULL,
  decided_on date,
  paid_on date,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS damage_claims_company ON damage_claims (company_id, status);
CREATE TABLE IF NOT EXISTS damage_claim_items (
  id serial PRIMARY KEY,
  claim_id integer NOT NULL REFERENCES damage_claims(id) ON DELETE CASCADE,
  product_id integer NOT NULL, -- inv_products
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(16,2) NOT NULL
);
