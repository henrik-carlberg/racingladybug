-- Sök i allt (fulltext inklusive text i underlag) och dokumentarkiv med taggar, gallringstid och arkivering av gamla år
ALTER TABLE attachments ADD COLUMN text text, ADD COLUMN text_source text CHECK (text_source IN ('pdf','file','ocr','none')), ADD COLUMN text_at timestamptz;
CREATE INDEX attachments_fts ON attachments USING gin (to_tsvector('swedish', filename || ' ' || COALESCE(text, '')));
CREATE INDEX attachments_untexted ON attachments (id) WHERE text_at IS NULL;
CREATE INDEX vouchers_fts ON vouchers USING gin (to_tsvector('swedish', description));
CREATE INDEX invoice_lines_fts ON invoice_lines USING gin (to_tsvector('swedish', description));
CREATE INDEX supplier_invoices_fts ON supplier_invoices USING gin (to_tsvector('swedish', description || ' ' || invoice_number || ' ' || payment_reference));
CREATE INDEX bank_transactions_fts ON bank_transactions USING gin (to_tsvector('swedish', description || ' ' || counterparty || ' ' || reference));

CREATE TABLE attachment_tags (
  attachment_id integer NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tag           text NOT NULL CHECK (tag ~ '^[a-z0-9åäö-]{2,30}$'),
  PRIMARY KEY (attachment_id, tag)
);
CREATE INDEX attachment_tags_company ON attachment_tags (company_id, tag);

-- Arkiverade räkenskapsår: förseglade (kontrollsumma) och utanför standardsökningen
ALTER TABLE fiscal_years ADD COLUMN archived_at timestamptz, ADD COLUMN archive_seal text, ADD COLUMN archived_by integer REFERENCES users(id) ON DELETE SET NULL;
