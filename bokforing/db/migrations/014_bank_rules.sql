-- Konteringsregler för banktransaktioner och inlärning av tidigare konteringar

CREATE TABLE bank_rules (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  pattern      text NOT NULL,                       -- sökord som alla ska finnas i motpart/text/referens
  direction    text NOT NULL DEFAULT 'any' CHECK (direction IN ('in','out','any')),
  amount_min   bigint,                              -- öre, absolutbelopp
  amount_max   bigint,
  account      integer NOT NULL,
  vat_rate     integer NOT NULL DEFAULT 0 CHECK (vat_rate IN (0,6,12,25)),
  description  text NOT NULL DEFAULT '',
  auto         boolean NOT NULL DEFAULT false,      -- bokförs automatiskt utan granskning
  priority     integer NOT NULL DEFAULT 0,
  hits         integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bank_rules_company ON bank_rules (company_id);

-- Vad en transaktion bokfördes mot (för att föreslå samma nästa gång)
ALTER TABLE bank_transactions
  ADD COLUMN booked_account integer,
  ADD COLUMN booked_vat     integer,
  ADD COLUMN learn_key      text,
  ADD COLUMN rule_id        integer REFERENCES bank_rules(id) ON DELETE SET NULL;
CREATE INDEX bank_transactions_learn ON bank_transactions (company_id, learn_key) WHERE booked_account IS NOT NULL;
