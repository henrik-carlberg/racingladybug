-- Flera pipelines per bolag, var och en med egna faser (steg).
CREATE TABLE crm_pipelines (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, name)
);

ALTER TABLE crm_stages ADD COLUMN pipeline_id integer REFERENCES crm_pipelines(id) ON DELETE CASCADE;

-- Befintliga steg flyttas till en pipeline "Försäljning" per bolag
INSERT INTO crm_pipelines (company_id, name, position)
  SELECT DISTINCT company_id, 'Försäljning', 10 FROM crm_stages;
UPDATE crm_stages s SET pipeline_id = p.id FROM crm_pipelines p WHERE p.company_id = s.company_id AND s.pipeline_id IS NULL;
ALTER TABLE crm_stages ALTER COLUMN pipeline_id SET NOT NULL;
CREATE INDEX crm_stages_pipeline ON crm_stages(pipeline_id, position);
