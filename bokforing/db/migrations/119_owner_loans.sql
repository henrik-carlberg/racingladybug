-- Lån till ägare, styrelse och närstående (låneförbudet)
CREATE TABLE IF NOT EXISTS owner_loans (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  borrower text NOT NULL,
  relation text NOT NULL CHECK (relation IN ('owner','board','ceo','related','related_company','group_company','employee','other')),
  purpose text NOT NULL DEFAULT 'private' CHECK (purpose IN ('private','business')),
  loan_date date NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  repaid bigint NOT NULL DEFAULT 0 CHECK (repaid >= 0),
  account integer NOT NULL DEFAULT 1685 CHECK (account BETWEEN 1300 AND 1699),
  note text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
