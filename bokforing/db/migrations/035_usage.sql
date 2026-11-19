-- Vad användaren gör oftast, per bolag. Poängen halveras efter en tid så att nya vanor tar över.
CREATE TABLE user_usage (
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  path       text NOT NULL,
  score      double precision NOT NULL DEFAULT 0,
  uses       int NOT NULL DEFAULT 0,
  last_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id, path)
);
CREATE INDEX user_usage_recent ON user_usage (user_id, company_id, last_at DESC);
ALTER TABLE users ADD COLUMN learn_usage boolean NOT NULL DEFAULT true;
