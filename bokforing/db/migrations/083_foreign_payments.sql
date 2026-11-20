-- Utlandsbetalningar: leverantörens IBAN/BIC och avgiftsval, betalningar i valuta med avräkning från banken
ALTER TABLE suppliers ADD COLUMN iban text NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN bic text NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN country text NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN charge_bearer text NOT NULL DEFAULT 'SHA' CHECK (charge_bearer IN ('SHA','OUR'));
ALTER TABLE suppliers ADD COLUMN reg_code text NOT NULL DEFAULT '';   -- kod för betalningsstatistik (Riksbanken/SCB) vid stora belopp
CREATE TABLE foreign_payments (
  id               serial PRIMARY KEY,
  company_id       integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_invoice_id integer NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  batch            text NOT NULL,
  currency         text NOT NULL,
  amount_currency  bigint NOT NULL,
  booked_sek       bigint NOT NULL,           -- skulden i kronor när filen skapades
  charge_bearer    text NOT NULL,
  debit_iban       text NOT NULL,
  status           text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','settled','cancelled')),
  paid_sek         bigint,
  fee              bigint,
  settled_on       date,
  created_by       integer REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX foreign_payments_open ON foreign_payments (supplier_invoice_id) WHERE status = 'sent';
CREATE INDEX foreign_payments_company ON foreign_payments (company_id, created_at DESC);
