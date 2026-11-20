-- Successiv vinstavräkning: fastprisuppdrag kopplade till ett projekt och bokade bokslutsjusteringar
CREATE TABLE poc_contracts (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id     integer NOT NULL REFERENCES projects(id),
  name           text NOT NULL,
  value          bigint NOT NULL CHECK (value > 0),           -- kontraktsvärde exkl. moms
  estimated_cost bigint NOT NULL CHECK (estimated_cost > 0),  -- beräknade totala kostnader
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id)
);
CREATE TABLE poc_postings (
  id             serial PRIMARY KEY,
  contract_id    integer NOT NULL REFERENCES poc_contracts(id) ON DELETE CASCADE,
  date           date NOT NULL,
  wip            bigint NOT NULL,
  loss_provision bigint NOT NULL,
  voucher_id     integer REFERENCES vouchers(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
