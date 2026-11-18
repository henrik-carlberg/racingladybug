-- Bilförmån, tjänstepension, semesterlöneregel
ALTER TABLE employees ADD COLUMN car_benefit bigint NOT NULL DEFAULT 0;                 -- förmånsvärde per månad, öre
ALTER TABLE employees ADD COLUMN pension_percent numeric(5,2) NOT NULL DEFAULT 0;        -- tjänstepension i % av kontant bruttolön
ALTER TABLE employees ADD COLUMN vacation_rule text NOT NULL DEFAULT 'same' CHECK (vacation_rule IN ('same','percent'));
ALTER TABLE employees ADD COLUMN employment_form text NOT NULL DEFAULT 'tillsvidare';  -- tillsvidare, visstid, provanställning, timanställd
ALTER TABLE employees ADD COLUMN title text NOT NULL DEFAULT '';
ALTER TABLE payslips ADD COLUMN pension bigint NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN pension_tax bigint NOT NULL DEFAULT 0;
