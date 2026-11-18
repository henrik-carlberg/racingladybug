-- Skattekontot: importerade transaktioner från Skatteverket
CREATE TABLE tax_account_entries (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date        date NOT NULL,
  text        text NOT NULL,
  amount      bigint NOT NULL,                  -- öre, positivt = kredit på skattekontot
  balance     bigint,                           -- saldo enligt Skatteverket efter transaktionen
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new','booked','bank','ignored')),
  voucher_id  integer REFERENCES vouchers(id),
  seq         integer NOT NULL,                 -- ordning i filen (samma datum, text och belopp kan förekomma flera gånger)
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, date, text, amount, seq)
);
