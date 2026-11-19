-- Leverantörsfaktura kopplad till inköpsorder (trevägsmatchning)
ALTER TABLE supplier_invoices ADD COLUMN purchase_order_id integer REFERENCES inv_purchase_orders(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX supplier_invoices_po ON supplier_invoices (purchase_order_id) WHERE purchase_order_id IS NOT NULL;
