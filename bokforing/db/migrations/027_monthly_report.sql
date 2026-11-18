-- Månadsrapport via e-post till ägarna
ALTER TABLE users ADD COLUMN monthly_report boolean NOT NULL DEFAULT true;
CREATE TABLE monthly_reports_sent (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period     text NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, period)
);
