-- Branschpaket: omvänd byggmoms, personalliggare bygg (ID06), timpris per person
ALTER TABLE customers ADD COLUMN construction_rc boolean NOT NULL DEFAULT false;   -- omvänd skattskyldighet för byggtjänster
ALTER TABLE invoices ADD COLUMN rc_kind text NOT NULL DEFAULT '' CHECK (rc_kind IN ('', 'eu', 'construction'));
UPDATE invoices SET rc_kind = 'eu' WHERE reverse_charge;
ALTER TABLE employees ADD COLUMN id06 text NOT NULL DEFAULT '';                     -- ID06-kortets nummer
ALTER TABLE work_sites ADD COLUMN kind text NOT NULL DEFAULT 'general' CHECK (kind IN ('general', 'construction'));
ALTER TABLE work_sites ADD COLUMN site_ref text NOT NULL DEFAULT '';               -- byggarbetsplatsens ID hos Skatteverket
ALTER TABLE staff_log ADD COLUMN id06 text NOT NULL DEFAULT '';
CREATE TABLE project_user_rates (
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rate       bigint NOT NULL CHECK (rate >= 0),   -- öre per timme exkl. moms
  PRIMARY KEY (project_id, user_id)
);
