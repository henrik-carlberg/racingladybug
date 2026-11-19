-- Påminnelser med SMS och inkasso via inkassobolagets API med status tillbaka
ALTER TABLE rk_settings ADD COLUMN sms boolean NOT NULL DEFAULT false;
ALTER TABLE rk_reminders ADD COLUMN sms_to text;
ALTER TABLE rk_collections ADD COLUMN case_id text, ADD COLUMN status text, ADD COLUMN status_text text NOT NULL DEFAULT '',
  ADD COLUMN collected bigint, ADD COLUMN updated_at timestamptz;
CREATE UNIQUE INDEX rk_collections_case ON rk_collections (case_id) WHERE case_id IS NOT NULL;
