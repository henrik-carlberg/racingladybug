/** Luhn-kontrollsiffra (modulus 10) för en sträng av siffror */
export function luhnCheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 2) return false;
  return luhnCheckDigit(digits.slice(0, -1)) === Number(digits[digits.length - 1]);
}

/** Normaliserar personnummer till ÅÅÅÅMMDDNNNN. Returnerar null om ogiltigt. */
export function normalizePersonalNumber(input: string, today = new Date()): string | null {
  const s = input.replace(/[\s-+]/g, '');
  let full: string;
  if (/^\d{12}$/.test(s)) full = s;
  else if (/^\d{10}$/.test(s)) {
    const yy = Number(s.slice(0, 2));
    const century = yy > today.getFullYear() % 100 ? 1900 : 2000;
    full = String(century + yy) + s.slice(2);
  } else return null;
  if (!luhnValid(full.slice(2))) return null;
  const month = Number(full.slice(4, 6));
  let day = Number(full.slice(6, 8));
  if (day > 60) day -= 60; // samordningsnummer
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return full;
}

/** Normaliserar organisationsnummer till NNNNNN-NNNN. Returnerar null om ogiltigt. */
export function normalizeOrgNumber(input: string): string | null {
  let s = input.replace(/[\s-]/g, '');
  if (/^16\d{10}$/.test(s)) s = s.slice(2);
  if (/^\d{12}$/.test(s)) s = s.slice(2); // personnummer för enskild firma
  if (!/^\d{10}$/.test(s) || !luhnValid(s)) return null;
  return `${s.slice(0, 6)}-${s.slice(6)}`;
}

/** 12-siffrigt ID för AGI: organisationsnummer med prefix 16, eller personnummer för enskild firma */
export function agiId(orgnr: string, companyType: 'AB' | 'EF', ownerPersonalNumber?: string): string {
  if (companyType === 'EF' && ownerPersonalNumber) return ownerPersonalNumber;
  return '16' + orgnr.replace(/\D/g, '').slice(-10);
}

/** OCR-nummer med längdsiffra och kontrollsiffra (Bankgirots "hård kontroll") */
export function makeOcr(base: number | string): string {
  const b = String(base).replace(/\D/g, '');
  const lengthDigit = String((b.length + 2) % 10);
  const withLength = b + lengthDigit;
  return withLength + String(luhnCheckDigit(withLength));
}

export function isValidOcr(ocr: string): boolean {
  if (!luhnValid(ocr)) return false;
  return Number(ocr[ocr.length - 2]) === ocr.length % 10;
}
