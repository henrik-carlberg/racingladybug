-- Obligatorisk återföring av överavskrivningar när reserven överstiger skillnaden mellan bokfört och lägsta skattemässiga värde
ALTER TABLE tax_appropriations DROP CONSTRAINT IF EXISTS tax_appropriations_kind_check;
ALTER TABLE tax_appropriations ADD CONSTRAINT tax_appropriations_kind_check CHECK (kind IN ('koncernbidrag','overavskrivning','periodiseringsfond','aterforing','aterforing_overavskrivning'));
