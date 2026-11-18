-- Fakturor i utländsk valuta och språk på kunddokument
ALTER TABLE customers ADD COLUMN currency text NOT NULL DEFAULT 'SEK';
ALTER TABLE customers ADD COLUMN language text NOT NULL DEFAULT 'sv' CHECK (language IN ('sv','en'));
-- Raderna (à-pris) är i fakturans valuta; total_net/total_vat/total är alltid i kronor (bokfört belopp)
ALTER TABLE invoices ADD COLUMN currency text NOT NULL DEFAULT 'SEK';
ALTER TABLE invoices ADD COLUMN exchange_rate numeric(14,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);
ALTER TABLE invoices ADD COLUMN total_currency bigint;      -- att betala i fakturans valuta (cent)
ALTER TABLE invoices ADD COLUMN language text NOT NULL DEFAULT 'sv' CHECK (language IN ('sv','en'));
ALTER TABLE invoices ADD COLUMN fx_result bigint NOT NULL DEFAULT 0;  -- kursvinst (+) / kursförlust (−) vid betalning, kronor
ALTER TABLE supplier_invoices ADD COLUMN currency text NOT NULL DEFAULT 'SEK';
ALTER TABLE supplier_invoices ADD COLUMN total_currency bigint;
