-- Förslag som användaren har avfärdat ("Inte nu"). Nyckeln innehåller månaden, så förslaget kommer tillbaka nästa gång.
CREATE TABLE suggestion_dismissals (
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key        text NOT NULL,
  user_id    int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key)
);
