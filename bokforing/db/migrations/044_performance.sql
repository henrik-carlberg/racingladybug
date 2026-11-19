-- Index för stora bolag (lasttest med 100 000 verifikationer)
CREATE INDEX IF NOT EXISTS vouchers_corrects ON vouchers (corrects_id) WHERE corrects_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vouchers_company_created ON vouchers (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vouchers_company_source ON vouchers (company_id, source_type, date);
CREATE INDEX IF NOT EXISTS voucher_lines_account ON voucher_lines (account_number, voucher_id);
CREATE INDEX IF NOT EXISTS invoices_company_status ON invoices (company_id, status, due_date);
CREATE INDEX IF NOT EXISTS supplier_invoices_company_status ON supplier_invoices (company_id, status, due_date);
CREATE INDEX IF NOT EXISTS audit_log_company_created ON audit_log (company_id, created_at DESC);
-- Jobbkö för bakgrundsarbete (tackmejl, notiser, tolkning av inkorgen); körs direkt efter svaret och av den dagliga körningen
CREATE TABLE IF NOT EXISTS jobs (
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',
  run_at     timestamptz NOT NULL DEFAULT now(),
  attempts   int NOT NULL DEFAULT 0,
  status     text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs (run_at) WHERE status = 'queued';
