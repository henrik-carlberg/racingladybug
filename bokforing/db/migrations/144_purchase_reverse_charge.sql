-- Inköp med omvänd skattskyldighet inom Sverige (byggtjänster och vissa varor)
ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS rc_kind text NOT NULL DEFAULT '' CHECK (rc_kind IN ('', 'construction', 'goods'));
ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS rc_vat bigint NOT NULL DEFAULT 0;
