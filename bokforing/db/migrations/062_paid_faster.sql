-- Betalt snabbare: Swish Handel från fakturan, mobilnummer för SMS, delbetalning som kunden väljer i portalen
ALTER TABLE customers ADD COLUMN phone text NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN swish_commerce boolean NOT NULL DEFAULT false,
  ADD COLUMN part_payment_max integer NOT NULL DEFAULT 0 CHECK (part_payment_max BETWEEN 0 AND 12),
  ADD COLUMN part_payment_min bigint NOT NULL DEFAULT 100000;

CREATE TABLE swish_payments (
  id              serial PRIMARY KEY,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id      integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  instruction_id  text NOT NULL UNIQUE,      -- vårt id hos Swish (32 hex)
  amount          bigint NOT NULL,
  status          text NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','declined','error','cancelled')),
  payer           text,
  reference       text,                      -- Swish betalningsreferens
  message         text NOT NULL DEFAULT '',
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX swish_payments_invoice ON swish_payments (invoice_id);

CREATE TABLE invoice_installments (
  invoice_id  integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  n           integer NOT NULL,
  due_date    date NOT NULL,
  amount      bigint NOT NULL CHECK (amount > 0),
  PRIMARY KEY (invoice_id, n)
);
ALTER TABLE invoices ADD COLUMN plan_chosen_at timestamptz;
