-- Skatteplanering för enskild firma: årets satser (statslåneränta, kommunalskatt, brytpunkt) per bolag
CREATE TABLE ef_tax_params (
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year           integer NOT NULL,
  slr_pct        numeric(6,3) NOT NULL CHECK (slr_pct >= 0 AND slr_pct < 20),
  municipal_pct  numeric(6,3) NOT NULL CHECK (municipal_pct > 0 AND municipal_pct < 50),
  brytpunkt      bigint NOT NULL CHECK (brytpunkt > 0),
  PRIMARY KEY (company_id, year)
);
