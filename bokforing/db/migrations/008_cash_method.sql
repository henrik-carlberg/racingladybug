-- Kontantmetoden (bokslutsmetoden): fakturor bokförs vid betalning, obetalda per bokslutsdagen.
ALTER TABLE companies ADD COLUMN accounting_method text NOT NULL DEFAULT 'invoice' CHECK (accounting_method IN ('invoice', 'cash'));
-- Första månad då debiterad preliminärskatt ska betalas (YYYY-MM), t.ex. efter uppskov första året.
ALTER TABLE companies ADD COLUMN prelskatt_from text CHECK (prelskatt_from ~ '^\d{4}-\d{2}$');
-- Konteringen sparas på fakturan så att den kan bokföras först vid betalning.
ALTER TABLE supplier_invoices ADD COLUMN cost_lines jsonb;
