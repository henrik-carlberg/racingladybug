-- Bokslutsrevision: genomförandeväsentlighet, obetydlighetsgräns och stickprov ur kund- och leverantörsreskontran per balansdagen
ALTER TABLE audit_engagements ADD COLUMN performance bigint NOT NULL DEFAULT 0, ADD COLUMN trivial bigint NOT NULL DEFAULT 0, ADD COLUMN materiality_basis text NOT NULL DEFAULT '';
CREATE TABLE audit_ledger_samples (
  id                  serial PRIMARY KEY,
  engagement_id       integer NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('customer','supplier')),
  invoice_id          integer REFERENCES invoices(id) ON DELETE CASCADE,
  supplier_invoice_id integer REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  open_amount         bigint NOT NULL,
  method              text NOT NULL,
  reason              text NOT NULL DEFAULT '',
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','remark')),
  comment             text NOT NULL DEFAULT '',
  sent_at             timestamptz,
  reviewed_by         integer REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  CHECK ((kind = 'customer') = (invoice_id IS NOT NULL) AND (kind = 'supplier') = (supplier_invoice_id IS NOT NULL))
);
CREATE UNIQUE INDEX audit_ledger_samples_inv ON audit_ledger_samples (engagement_id, invoice_id) WHERE invoice_id IS NOT NULL;
CREATE UNIQUE INDEX audit_ledger_samples_sinv ON audit_ledger_samples (engagement_id, supplier_invoice_id) WHERE supplier_invoice_id IS NOT NULL;
