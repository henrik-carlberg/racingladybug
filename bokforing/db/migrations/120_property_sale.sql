-- Försäljning av fastighet
ALTER TABLE tax_properties ADD COLUMN IF NOT EXISTS sold_on date;
ALTER TABLE tax_properties ADD COLUMN IF NOT EXISTS sale jsonb;
ALTER TABLE tax_properties ADD COLUMN IF NOT EXISTS sale_voucher_id integer REFERENCES vouchers(id);
