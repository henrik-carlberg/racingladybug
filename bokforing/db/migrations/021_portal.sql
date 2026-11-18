-- Kundportal: hemlig länk per kund med fakturor, betalning och offerter

ALTER TABLE customers ADD COLUMN portal_token text UNIQUE;

CREATE TABLE portal_quote_acceptances (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id  integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  deal_id      integer NOT NULL,
  accepted_by  text NOT NULL,                 -- namnet som kunden skrev
  total        bigint NOT NULL,
  ip           text NOT NULL DEFAULT '',
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id)
);
