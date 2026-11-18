-- Obetalda fakturor importerade från ett tidigare system: fordran/skulden finns redan i ingående balans (1510/2440),
-- så de bokförs inte här – betalningen bokförs mot 1510/2440 oavsett bokföringsmetod.
ALTER TABLE invoices ADD COLUMN imported boolean NOT NULL DEFAULT false;
ALTER TABLE supplier_invoices ADD COLUMN imported boolean NOT NULL DEFAULT false;
