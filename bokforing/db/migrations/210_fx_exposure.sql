-- Valutaexponering: aktuell kurs och gräns för osäkrad exponering per valuta
CREATE TABLE IF NOT EXISTS fx_exposure_settings (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  rate numeric(12,6) CHECK (rate > 0),
  limit_sek bigint CHECK (limit_sek >= 0),
  PRIMARY KEY (company_id, currency)
);
