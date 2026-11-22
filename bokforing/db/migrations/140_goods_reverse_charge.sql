-- Omvänd skattskyldighet för vissa varor inom Sverige (mobiltelefoner, datorkretsar, metaller, guld, skrot)
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_rc_kind_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_rc_kind_check CHECK (rc_kind IN ('', 'eu', 'construction', 'goods'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS goods_category text CHECK (goods_category IS NULL OR goods_category IN ('electronics','metals','gold','scrap'));
