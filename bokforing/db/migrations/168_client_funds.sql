-- Klientmedel: medel som förvaltas åt klienter på ett avskilt bankkonto, med reskontra per klient och avstämning mot bokföringen
CREATE TABLE IF NOT EXISTS client_fund_settings (
  company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  bank_account integer NOT NULL DEFAULT 1940 CHECK (bank_account BETWEEN 1900 AND 1999),
  liability_account integer NOT NULL DEFAULT 2890 CHECK (liability_account BETWEEN 2000 AND 2999)
);
CREATE TABLE IF NOT EXISTS fund_clients (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  reference text NOT NULL DEFAULT '',
  customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
  closed boolean NOT NULL DEFAULT false,
  UNIQUE (company_id, name, reference)
);
CREATE TABLE IF NOT EXISTS client_fund_entries (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id integer NOT NULL REFERENCES fund_clients(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('deposit','payout','fee')),
  amount bigint NOT NULL CHECK (amount > 0),
  note text NOT NULL DEFAULT '',
  invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_fund_entries_client ON client_fund_entries (client_id, date);
