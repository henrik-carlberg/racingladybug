-- Punktskatter: skatteslag med skattesats per enhet, underlag från lagerleveranser och egna uttag, månadsdeklaration och betalning via skattekontot
CREATE TABLE IF NOT EXISTS excise_types (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'kg',
  rate numeric(14,4) NOT NULL CHECK (rate > 0), -- öre per enhet
  cost_account integer NOT NULL DEFAULT 6900,
  invoice_line boolean NOT NULL DEFAULT false, -- punktskatten som egen rad på fakturor från kundorder
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, name)
);
CREATE TABLE IF NOT EXISTS excise_products (
  excise_type_id integer NOT NULL REFERENCES excise_types(id) ON DELETE CASCADE,
  product_id integer NOT NULL, -- inv_products (lagermodulens tabell skapas efter kärnans migreringar)
  factor numeric(14,4) NOT NULL CHECK (factor > 0), -- skattepliktiga enheter per artikelenhet
  PRIMARY KEY (excise_type_id, product_id)
);
CREATE TABLE IF NOT EXISTS excise_entries (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  excise_type_id integer NOT NULL REFERENCES excise_types(id) ON DELETE CASCADE,
  date date NOT NULL,
  quantity numeric(14,3) NOT NULL,
  note text NOT NULL DEFAULT '',
  return_id integer,
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS excise_returns (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  lines jsonb NOT NULL,
  total bigint NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  paid_on date,
  paid_voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period)
);
