-- Kom igång-guidens status per bolag (överhoppade steg, svar som "har anställda")
ALTER TABLE companies ADD COLUMN setup jsonb NOT NULL DEFAULT '{}';
