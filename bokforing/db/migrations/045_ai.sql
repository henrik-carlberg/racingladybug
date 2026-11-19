-- Förslag från AI: verifikation utifrån fritext, konto för banktransaktioner
CREATE TABLE ai_suggestions (
  id         serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    int REFERENCES users(id) ON DELETE SET NULL,
  kind       text NOT NULL CHECK (kind IN ('voucher')),
  input      text NOT NULL,
  output     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bank_transactions ADD COLUMN ai_suggestion jsonb;
