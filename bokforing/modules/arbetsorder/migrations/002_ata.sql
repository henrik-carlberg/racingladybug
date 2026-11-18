-- ÄTA-arbeten (ändrings- och tilläggsarbeten) på arbetsordrar, med kundens godkännande
ALTER TABLE wo_items DROP CONSTRAINT wo_items_kind_check;
ALTER TABLE wo_items ADD CONSTRAINT wo_items_kind_check CHECK (kind IN ('labor','material','other','ata'));
ALTER TABLE wo_items ADD COLUMN approved_by text NOT NULL DEFAULT '';
