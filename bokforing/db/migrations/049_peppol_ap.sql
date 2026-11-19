-- Peppol via åtkomstpunkt: skickade och mottagna e-fakturor med leveransstatus
CREATE TABLE peppol_messages (
  id            serial PRIMARY KEY,
  company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  direction     text NOT NULL CHECK (direction IN ('out','in')),
  invoice_id    integer REFERENCES invoices(id) ON DELETE SET NULL,
  inbox_document_id integer REFERENCES inbox_documents(id) ON DELETE SET NULL,
  external_id   text,
  sender        text NOT NULL DEFAULT '',
  receiver      text NOT NULL DEFAULT '',
  status        text NOT NULL CHECK (status IN ('sent','delivered','failed','received')),
  message       text NOT NULL DEFAULT '',
  created_by    integer REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX peppol_messages_ext ON peppol_messages (direction, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX peppol_messages_company ON peppol_messages (company_id, created_at DESC);
CREATE INDEX peppol_messages_invoice ON peppol_messages (invoice_id) WHERE invoice_id IS NOT NULL;
ALTER TABLE inbox_documents DROP CONSTRAINT IF EXISTS inbox_documents_source_check;
ALTER TABLE inbox_documents ADD CONSTRAINT inbox_documents_source_check CHECK (source IN ('email','upload','peppol'));
