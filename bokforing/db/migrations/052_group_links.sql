-- Koncernstruktur: moderbolag, dotterbolag, ägarandel och förvärvsuppgifter för kapitalelimineringen
CREATE TABLE group_links (
  parent_company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subsidiary_company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ownership             numeric(5,2) NOT NULL DEFAULT 100 CHECK (ownership > 0 AND ownership <= 100),
  acquisition_cost      bigint,      -- anskaffningsvärde för aktierna (öre); tomt = moderbolagets konto 1310–1319
  acquired_equity       bigint,      -- dotterbolagets eget kapital vid förvärvet (öre); tomt = bundet eget kapital
  updated_by            integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_company_id, subsidiary_company_id),
  CHECK (parent_company_id <> subsidiary_company_id)
);
