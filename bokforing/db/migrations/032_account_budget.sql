-- Budget per resultatkonto och månad (öre; intäkter och kostnader som positiva belopp)
CREATE TABLE account_budgets (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year       integer NOT NULL,
  month      integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  account    integer NOT NULL CHECK (account BETWEEN 3000 AND 8999),
  amount     bigint NOT NULL,
  PRIMARY KEY (company_id, year, month, account)
);
