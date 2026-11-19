-- Årshjul: egna återkommande aktiviteter, avbockade tillfällen och kalenderlänkar
CREATE TABLE wheel_activities (
  id            serial PRIMARY KEY,
  company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  module        text NOT NULL,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  recurrence    text NOT NULL CHECK (recurrence IN ('once','weekly','monthly','quarterly','yearly')),
  day           integer CHECK (day BETWEEN 1 AND 31),
  month         integer CHECK (month BETWEEN 1 AND 12),
  start_date    date NOT NULL,
  end_date      date,
  owner_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  remind_days   integer NOT NULL DEFAULT 3 CHECK (remind_days BETWEEN 0 AND 60),
  created_by    integer REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wheel_activities_company ON wheel_activities (company_id);
CREATE TABLE wheel_done (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key        text NOT NULL,
  done_by    integer REFERENCES users(id) ON DELETE SET NULL,
  done_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key)
);
CREATE TABLE calendar_tokens (
  token_hash text PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id)
);
CREATE TABLE wheel_reminders (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key        text NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key)
);
