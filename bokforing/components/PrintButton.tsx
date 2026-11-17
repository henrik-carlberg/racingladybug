'use client';
export function PrintButton({ label = 'Skriv ut / spara PDF' }: { label?: string }) {
  return <button type="button" onClick={() => window.print()}>{label}</button>;
}
