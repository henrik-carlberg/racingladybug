-- Jämkning: tjugo år för ny-, till- och ombyggnad av fastighet, och slutjämkning när investeringsvaran avyttras
ALTER TABLE vat_investments DROP CONSTRAINT IF EXISTS vat_investments_kind_check;
ALTER TABLE vat_investments ADD CONSTRAINT vat_investments_kind_check CHECK (kind IN ('fastighet','nybyggnad','inventarie'));
ALTER TABLE vat_investments ADD COLUMN IF NOT EXISTS disposed_year integer, ADD COLUMN IF NOT EXISTS disposal text CHECK (disposal IS NULL OR disposal IN ('taxable','exempt'));
