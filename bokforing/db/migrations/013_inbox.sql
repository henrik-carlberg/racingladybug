-- Inkorg för leverantörsfakturor: e-post till bolagets egen adress eller uppladdning, tolkas och granskas innan registrering

ALTER TABLE companies ADD COLUMN inbox_token text UNIQUE;

CREATE TABLE inbox_documents (
  id                  serial PRIMARY KEY,
  company_id          integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source              text NOT NULL CHECK (source IN ('email','upload')),
  message_id          text,                       -- e-postens id hos mottagartjänsten, för att inte ta emot samma mejl två gånger
  from_address        text NOT NULL DEFAULT '',
  subject             text NOT NULL DEFAULT '',
  filename            text NOT NULL DEFAULT '',
  mime_type           text NOT NULL DEFAULT '',
  data                bytea,
  status              text NOT NULL DEFAULT 'new' CHECK (status IN ('new','ready','failed','registered','rejected')),
  extracted           jsonb,
  error               text NOT NULL DEFAULT '',
  supplier_invoice_id integer REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  uploaded_by         integer REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  handled_at          timestamptz
);
CREATE INDEX inbox_documents_company ON inbox_documents (company_id, status, created_at DESC);
CREATE UNIQUE INDEX inbox_documents_once ON inbox_documents (company_id, message_id, filename) WHERE message_id IS NOT NULL;
