-- Betalningsföreläggande hos Kronofogden
CREATE TABLE IF NOT EXISTS payment_orders (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','ruling','enforcement','paid','withdrawn')),
  applied_on date NOT NULL,
  case_no text NOT NULL DEFAULT '',
  capital bigint NOT NULL,
  interest_rate numeric(5,2) NOT NULL,
  reminder_fee bigint NOT NULL DEFAULT 0,
  fee bigint NOT NULL,
  fee_voucher_id integer REFERENCES vouchers(id),
  recovered bigint NOT NULL DEFAULT 0,
  interest_paid bigint NOT NULL DEFAULT 0,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_active ON payment_orders (invoice_id) WHERE status NOT IN ('withdrawn','paid');
