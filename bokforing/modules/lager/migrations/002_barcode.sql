-- Streckkod (EAN/GTIN) på artiklar för inventering med skanner
ALTER TABLE inv_products ADD COLUMN barcode text NOT NULL DEFAULT '';
CREATE INDEX inv_products_barcode ON inv_products (company_id, barcode) WHERE barcode <> '';
