-- Aktieägare (för K10 och utdelning) och utbetalda utdelningar per ägare (underlag för kontrolluppgift KU31)
CREATE TABLE company_owners (
  id              serial PRIMARY KEY,
  company_id      int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            text NOT NULL,
  personal_number text NOT NULL DEFAULT '',
  share_pct       numeric(7,3) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
  cost_basis      bigint NOT NULL DEFAULT 0,  -- omkostnadsbelopp (öre)
  saved_space     bigint NOT NULL DEFAULT 0,  -- sparat utdelningsutrymme från förra årets K10 (öre)
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_owners_company ON company_owners (company_id);
CREATE TABLE dividend_payouts (
  id         serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  voucher_id int NOT NULL REFERENCES vouchers(id),
  date       date NOT NULL,
  total      bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dividend_payout_lines (
  payout_id  int NOT NULL REFERENCES dividend_payouts(id) ON DELETE CASCADE,
  owner_id   int REFERENCES company_owners(id) ON DELETE SET NULL,
  name       text NOT NULL,
  personal_number text NOT NULL DEFAULT '',
  amount     bigint NOT NULL
);
