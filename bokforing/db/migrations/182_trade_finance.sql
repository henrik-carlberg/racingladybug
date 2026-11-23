-- Remburser och bankgarantier: import- och exportremburser med dokumentkrav, ställda och mottagna garantier, bankavgifter, spärrade medel och ansvarsförbindelser till årsredovisningen
CREATE TABLE IF NOT EXISTS trade_finance (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('lc_import','lc_export','guarantee_given','guarantee_received')),
  counterparty text NOT NULL,
  bank text NOT NULL DEFAULT '',
  reference text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'SEK' CHECK (currency ~ '^[A-Z]{3}$'),
  amount numeric(16,2) NOT NULL CHECK (amount > 0), -- i valutan
  amount_sek bigint NOT NULL CHECK (amount_sek > 0), -- öre
  issued_on date NOT NULL,
  expires_on date NOT NULL,
  documents jsonb NOT NULL DEFAULT '[]', -- [{name, done}]
  blocked bigint NOT NULL DEFAULT 0 CHECK (blocked >= 0), -- spärrade egna medel som säkerhet, öre
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','utilized','closed','expired')),
  closed_on date,
  guarantee_commitment_id integer REFERENCES commitments(id) ON DELETE SET NULL,
  pledge_commitment_id integer REFERENCES commitments(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id),
  CHECK (expires_on >= issued_on)
);
CREATE TABLE IF NOT EXISTS trade_finance_fees (
  id serial PRIMARY KEY,
  trade_finance_id integer NOT NULL REFERENCES trade_finance(id) ON DELETE CASCADE,
  date date NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  description text NOT NULL DEFAULT '',
  voucher_id integer REFERENCES vouchers(id)
);
