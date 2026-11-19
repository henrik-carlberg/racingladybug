-- Digital post: fakturor och lönebesked till Kivra med status tillbaka, och kundens föredragna kanal
ALTER TABLE customers ADD COLUMN delivery text NOT NULL DEFAULT 'auto' CHECK (delivery IN ('auto','peppol','kivra','email','paper'));
ALTER TABLE invoices ADD COLUMN sent_via text;
CREATE TABLE kivra_deliveries (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('invoice','payslip')),
  invoice_id   integer REFERENCES invoices(id) ON DELETE CASCADE,
  payslip_id   integer REFERENCES payslips(id) ON DELETE CASCADE,
  content_key  text,
  status       text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','delivered','read','failed')),
  message      text NOT NULL DEFAULT '',
  created_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kivra_deliveries_open ON kivra_deliveries (status) WHERE status IN ('sent','delivered');
CREATE UNIQUE INDEX kivra_deliveries_payslip ON kivra_deliveries (payslip_id) WHERE payslip_id IS NOT NULL AND status <> 'failed';
