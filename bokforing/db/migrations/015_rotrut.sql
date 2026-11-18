-- ROT- och RUT-avdrag på kundfakturor (fakturamodellen)

ALTER TABLE invoice_lines ADD COLUMN labor boolean NOT NULL DEFAULT false;

ALTER TABLE invoices
  ADD COLUMN reduction_type   text CHECK (reduction_type IN ('rot','rut')),
  ADD COLUMN tax_reduction    bigint NOT NULL DEFAULT 0,        -- öre som begärs från Skatteverket (kunden betalar total = resten)
  ADD COLUMN reduction_max    bigint,                           -- köparens återstående tak enligt kunden (öre), om angivet
  ADD COLUMN buyer_pnr        text NOT NULL DEFAULT '',
  ADD COLUMN property         text NOT NULL DEFAULT '',         -- fastighetsbeteckning (ROT, småhus)
  ADD COLUMN brf_orgnr        text NOT NULL DEFAULT '',         -- bostadsrättsförening (ROT, bostadsrätt)
  ADD COLUMN apartment_no     text NOT NULL DEFAULT '',
  ADD COLUMN work_type        text NOT NULL DEFAULT '',
  ADD COLUMN reduction_status text CHECK (reduction_status IN ('to_request','requested','paid','partly_paid','rejected')),
  ADD COLUMN reduction_requested_on date,
  ADD COLUMN reduction_paid    bigint,
  ADD COLUMN reduction_decided_on date,
  ADD COLUMN reduction_voucher_id integer REFERENCES vouchers(id),
  ADD COLUMN reduction_rest_invoice_id integer REFERENCES invoices(id);
CREATE INDEX invoices_reduction ON invoices (company_id, reduction_status) WHERE reduction_type IS NOT NULL;

-- Konto för fordran på Skatteverket i alla befintliga bolag
INSERT INTO accounts (company_id, number, name) SELECT id, 1513, 'Kundfordringar – delad faktura (ROT/RUT)' FROM companies ON CONFLICT DO NOTHING;
