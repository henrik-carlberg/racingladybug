-- Tvistiga kundfakturor: påminnelser, ränta och inkasso pausas; avslutas med full betalning, förlikning eller återtagen tvist
CREATE TABLE IF NOT EXISTS invoice_disputes (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  opened_on date NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled','withdrawn','paid')),
  closed_on date,
  agreed_amount bigint,
  reduction bigint,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_disputes_open ON invoice_disputes (invoice_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS invoice_disputes_company ON invoice_disputes (company_id, status);
