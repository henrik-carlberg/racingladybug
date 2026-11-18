-- Kostnadsställen och projekt på verifikationsrader (SIE-dimension 1 och 6)

CREATE TABLE cost_centers (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

ALTER TABLE voucher_lines
  ADD COLUMN cost_center_id integer REFERENCES cost_centers(id),
  ADD COLUMN project_id     integer REFERENCES projects(id);
CREATE INDEX voucher_lines_cost_center ON voucher_lines (cost_center_id) WHERE cost_center_id IS NOT NULL;
CREATE INDEX voucher_lines_project ON voucher_lines (project_id) WHERE project_id IS NOT NULL;

ALTER TABLE bank_rules ADD COLUMN cost_center_id integer REFERENCES cost_centers(id) ON DELETE SET NULL;
ALTER TABLE suppliers ADD COLUMN cost_center_id integer REFERENCES cost_centers(id) ON DELETE SET NULL;
