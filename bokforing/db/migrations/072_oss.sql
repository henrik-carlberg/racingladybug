-- OSS: köparlandets moms på fakturarader till privatpersoner i andra EU-länder
ALTER TABLE companies ADD COLUMN oss_registered boolean NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN oss_country text CHECK (oss_country ~ '^[A-Z]{2}$');
ALTER TABLE invoice_lines ADD COLUMN oss_rate numeric(4,1) CHECK (oss_rate >= 0 AND oss_rate < 40);
