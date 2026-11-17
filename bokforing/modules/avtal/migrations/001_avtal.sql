-- Avtal och abonnemang med återkommande fakturering, uppsägningstid och förnyelse.
CREATE TABLE avt_contracts (
  id                serial PRIMARY KEY,
  company_id        integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id       integer NOT NULL REFERENCES customers(id),
  name              text NOT NULL,
  start_date        date NOT NULL,
  end_date          date,                                -- null = tillsvidare
  interval_months   integer NOT NULL DEFAULT 1 CHECK (interval_months IN (1, 3, 6, 12)),
  in_advance        boolean NOT NULL DEFAULT true,       -- förskott (perioden faktureras i början) eller efterskott
  next_period_start date NOT NULL,
  notice_months     integer NOT NULL DEFAULT 3 CHECK (notice_months >= 0),
  auto_renew        boolean NOT NULL DEFAULT true,
  renewal_months    integer NOT NULL DEFAULT 12 CHECK (renewal_months > 0),
  auto_book         boolean NOT NULL DEFAULT false,      -- bokför fakturan direkt (annars utkast)
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  your_reference    text NOT NULL DEFAULT '',
  notes             text NOT NULL DEFAULT '',
  document_id       integer REFERENCES documents(id) ON DELETE SET NULL,
  created_by        integer NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX avt_contracts_due ON avt_contracts(company_id, status, next_period_start);

CREATE TABLE avt_lines (
  id          serial PRIMARY KEY,
  contract_id integer NOT NULL REFERENCES avt_contracts(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  description text NOT NULL,
  quantity    numeric(12,3) NOT NULL DEFAULT 1,
  unit        text NOT NULL DEFAULT 'st',
  unit_price  bigint NOT NULL,                          -- öre per period exkl. moms
  vat_rate    integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 6, 12, 25))
);

CREATE TABLE avt_invoices (
  contract_id  integer NOT NULL REFERENCES avt_contracts(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  invoice_id   integer REFERENCES invoices(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, period_start)
);
