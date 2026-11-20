-- Förvärvsanalys: förvärvsdag, övervärden, avskrivningstider och internvinst i lager per dotterbolag
ALTER TABLE group_links ADD COLUMN acquired_on date, ADD COLUMN goodwill_years integer NOT NULL DEFAULT 5 CHECK (goodwill_years BETWEEN 1 AND 20),
  ADD COLUMN surplus bigint NOT NULL DEFAULT 0 CHECK (surplus >= 0), ADD COLUMN surplus_years integer NOT NULL DEFAULT 10 CHECK (surplus_years BETWEEN 1 AND 50),
  ADD COLUMN intra_inventory bigint NOT NULL DEFAULT 0 CHECK (intra_inventory >= 0), ADD COLUMN intra_inventory_opening bigint NOT NULL DEFAULT 0 CHECK (intra_inventory_opening >= 0),
  ADD COLUMN intra_margin numeric(5,2) NOT NULL DEFAULT 0 CHECK (intra_margin >= 0 AND intra_margin <= 100);
