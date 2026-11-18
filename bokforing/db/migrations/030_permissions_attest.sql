-- Behörighet per användare (NULL = alla behörigheter rollen ger), attest i flera steg
ALTER TABLE memberships ADD COLUMN permissions text[];
ALTER TABLE companies ADD COLUMN attest_threshold bigint;               -- fakturor från detta belopp (öre) kräver två attester
ALTER TABLE companies ADD COLUMN attest_not_registrant boolean NOT NULL DEFAULT false;  -- den som registrerat får inte attestera
CREATE TABLE supplier_invoice_approvals (
  supplier_invoice_id integer NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  user_id             integer NOT NULL REFERENCES users(id),
  approved_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier_invoice_id, user_id)
);
ALTER TABLE supplier_invoices ADD COLUMN registered_by integer REFERENCES users(id);
INSERT INTO supplier_invoice_approvals (supplier_invoice_id, user_id, approved_at)
  SELECT id, approved_by, COALESCE(approved_at, now()) FROM supplier_invoices WHERE approved_by IS NOT NULL ON CONFLICT DO NOTHING;
