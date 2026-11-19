-- Inköp: automatisk attest vid trevägsmatchning, leverantörsavtal med uppsägningsbevakning och prisbevakning
ALTER TABLE companies ADD COLUMN auto_attest_matched boolean NOT NULL DEFAULT false;
ALTER TABLE supplier_invoices ADD COLUMN match_status text CHECK (match_status IN ('matched','price_diff','qty_diff','no_receipt')), ADD COLUMN auto_approved boolean NOT NULL DEFAULT false;
CREATE TABLE supplier_contracts (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id    integer REFERENCES suppliers(id) ON DELETE SET NULL,
  name           text NOT NULL,
  start_date     date,
  end_date       date,
  notice_months  integer NOT NULL DEFAULT 0 CHECK (notice_months BETWEEN 0 AND 60),
  auto_renew     boolean NOT NULL DEFAULT false,
  renew_months   integer NOT NULL DEFAULT 12 CHECK (renew_months BETWEEN 0 AND 120),
  monthly_cost   bigint,
  responsible    integer REFERENCES users(id) ON DELETE SET NULL,
  notes          text NOT NULL DEFAULT '',
  reminded_for   date,
  created_by     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supplier_contracts_company ON supplier_contracts (company_id);
ALTER TABLE risk_alerts DROP CONSTRAINT risk_alerts_kind_check;
ALTER TABLE risk_alerts ADD CONSTRAINT risk_alerts_kind_check CHECK (kind IN ('bank_change','duplicate','large','new_recipient','weekend','price_increase'));
