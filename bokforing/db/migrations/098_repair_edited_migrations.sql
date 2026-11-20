-- Reparation: 073 och 078 ändrades efter att de redan körts mot produktionsdatabasen, så tilläggen kom aldrig med där.
-- Idempotent – gör ingenting i databaser där kolumnerna redan finns.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS accept_intercompany boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS sso_company_id integer REFERENCES companies(id) ON DELETE CASCADE;
