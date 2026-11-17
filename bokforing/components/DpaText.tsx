import { DPA_VERSION, PROVIDER, SUBPROCESSORS } from '@/lib/legal';

/** Personuppgiftsbiträdesavtal enligt GDPR art. 28. Låt en jurist granska texten innan tjänsten säljs. */
export function DpaText({ company }: { company?: { name: string; orgnr: string } }) {
  const p = PROVIDER;
  return (
    <div className="legal small">
      <p><b>Parter.</b> {company ? `${company.name} (${company.orgnr})` : 'Kunden'} är personuppgiftsansvarig. {p.name}{p.orgnr ? ` (${p.orgnr})` : ''} är personuppgiftsbiträde och tillhandahåller tjänsten. Version {DPA_VERSION}.</p>
      <p><b>1. Ändamål och instruktion.</b> Biträdet behandlar personuppgifter enbart för att leverera tjänsten (bokföring, fakturering, lön, HR och övriga aktiverade moduler) och enligt Kundens dokumenterade instruktioner, som utgörs av detta avtal och Kundens användning av tjänsten.</p>
      <p><b>2. Kategorier.</b> Registrerade: Kundens anställda, kunder, leverantörer, kontaktpersoner och användare. Uppgifter: namn, kontaktuppgifter, personnummer, bankkonto, lön, skatt, frånvaro (inklusive sjukfrånvaro, som är en känslig uppgift om hälsa), tidrapporter, fakturor och betalningar.</p>
      <p><b>3. Säkerhet (art. 32).</b> Krypterad överföring (TLS), krypterad lagring hos databasleverantören, lösenord lagras som bcrypt-hash, stöd för passkeys och tvåstegsverifiering, behörigheter per roll, behörighetslogg (vem gjorde vad och när) och regelbunden säkerhetskopiering.</p>
      <p><b>4. Sekretess.</b> Personer som behandlar uppgifterna hos Biträdet omfattas av tystnadsplikt.</p>
      <p><b>5. Underbiträden.</b> Kunden godkänner underbiträdena nedan. Biträdet meddelar Kunden i förväg om nya underbiträden, och Kunden har rätt att invända. Överföring utanför EU/EES sker bara med stöd av EU-kommissionens standardavtalsklausuler eller annat giltigt överföringsstöd.</p>
      <table className="small"><thead><tr><th>Underbiträde</th><th>Syfte</th><th>Plats</th></tr></thead>
        <tbody>{SUBPROCESSORS.map((s) => <tr key={s.name}><td>{s.name}</td><td>{s.purpose}</td><td>{s.location}</td></tr>)}</tbody></table>
      <p><b>6. Den registrerades rättigheter.</b> Biträdet hjälper Kunden att besvara begäran om registerutdrag, rättelse, radering och dataportabilitet. Användare kan själva ladda ner sina uppgifter och radera sitt konto under Mitt konto.</p>
      <p><b>7. Personuppgiftsincident.</b> Biträdet underrättar Kunden utan onödigt dröjsmål, och senast inom 36 timmar efter att ha fått kännedom om en incident, så att Kunden kan anmäla den till IMY inom 72 timmar.</p>
      <p><b>8. Revision.</b> Kunden har rätt att kontrollera att avtalet följs, genom att begära information eller genom revision efter skriftligt meddelande.</p>
      <p><b>9. Avtalets upphörande.</b> När avtalet upphör kan Kunden exportera all data (SIE och JSON). Därefter raderas uppgifterna inom 90 dagar, om inte lag kräver att de sparas. Räkenskapsinformation sparas enligt bokföringslagen (7 år) om Kunden inte själv har tagit hand om den.</p>
      {p.email && <p><b>Kontakt.</b> {p.email}</p>}
    </div>
  );
}
