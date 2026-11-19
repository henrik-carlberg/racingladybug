-- Pushnotiser (Web Push). En användare kan ha flera enheter.
CREATE TABLE push_subscriptions (
  id         serial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  device     text NOT NULL DEFAULT '',
  failures   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);
-- Vilka notiser användaren vill ha
ALTER TABLE users ADD COLUMN push_prefs text[] NOT NULL DEFAULT '{attest,paid,deadline,bank,mention}';
-- Skickade notiser som inte ska skickas igen (t.ex. deadline om tre dagar)
CREATE TABLE push_log (key text PRIMARY KEY, sent_at timestamptz NOT NULL DEFAULT now());
