-- AI-funktioner (assistenten, avläsning, AI-kontering) per användare: ägaren har alltid tillgång, övriga när ägaren slår på det
ALTER TABLE memberships ADD COLUMN ai_access boolean NOT NULL DEFAULT false;
