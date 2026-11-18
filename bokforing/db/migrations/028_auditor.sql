-- Revisor: läsbehörighet till hela bokföringen, kan inte ändra något
ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'accountant', 'employee', 'auditor'));
ALTER TABLE invites DROP CONSTRAINT invites_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_role_check CHECK (role IN ('owner', 'accountant', 'employee', 'auditor'));
