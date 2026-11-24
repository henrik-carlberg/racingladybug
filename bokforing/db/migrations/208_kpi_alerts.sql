-- Nyckeltalslarm: egna gränsvärden på nyckeltal, larm på översikten och med e-post, historik över utlösta och hävda larm
CREATE TABLE IF NOT EXISTS kpi_alerts (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  metric text NOT NULL CHECK (metric IN ('solidity', 'quick', 'cash', 'dso', 'gross', 'operating', 'payroll_budget')),
  comparator text NOT NULL CHECK (comparator IN ('below', 'above')),
  threshold numeric(16,2) NOT NULL,
  email boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS kpi_alert_events (
  id serial PRIMARY KEY,
  alert_id integer NOT NULL REFERENCES kpi_alerts(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  value numeric(16,2),
  cleared_at timestamptz,
  cleared_value numeric(16,2)
);
CREATE INDEX IF NOT EXISTS kpi_alert_events_open ON kpi_alert_events (company_id) WHERE cleared_at IS NULL;
