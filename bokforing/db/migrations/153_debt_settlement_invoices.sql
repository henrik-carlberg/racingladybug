-- Varje leverantörsfaktura kan bara omfattas av ett ackord
CREATE TABLE IF NOT EXISTS debt_settlement_invoices (
  supplier_invoice_id integer PRIMARY KEY REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  settlement_id integer NOT NULL REFERENCES debt_settlements(id) ON DELETE CASCADE
);
