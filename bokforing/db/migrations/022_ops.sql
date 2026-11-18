-- Drift: begränsning av anrop, fellogg och hjärtslag för schemalagda jobb

CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE error_log (
  id           serial PRIMARY KEY,
  fingerprint  text NOT NULL UNIQUE,              -- samma fel grupperas
  message      text NOT NULL,
  stack        text NOT NULL DEFAULT '',
  path         text NOT NULL DEFAULT '',
  method       text NOT NULL DEFAULT '',
  kind         text NOT NULL DEFAULT '',          -- render, route, action, cron
  count        integer NOT NULL DEFAULT 1,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  alerted_at   timestamptz,
  resolved_at  timestamptz
);

CREATE TABLE cron_runs (
  job          text PRIMARY KEY,
  last_started timestamptz,
  last_ok      timestamptz,
  last_error   text NOT NULL DEFAULT '',
  last_result  jsonb
);
ALTER TABLE companies ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
