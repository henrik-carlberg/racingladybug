-- Gränssnittets språk per användare
ALTER TABLE users ADD COLUMN locale text NOT NULL DEFAULT 'sv' CHECK (locale IN ('sv','en'));
