import { getBase, getPublishedApp } from "../data";

// Template only – each business owner is responsible for their own privacy policy.
// Have the final wording checked (e.g. eRecht24 / lawyer) before going live.
export default async function Datenschutz({ params }: PageProps<"/s/[slug]/datenschutz">) {
  const { slug } = await params;
  const app = (await getPublishedApp(slug))!;
  const l = app.legal;
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-5 py-10 leading-relaxed">
      <a href={`${await getBase(slug)}/`} className="text-sm underline">← {app.name}</a>
      <h1 className="text-2xl font-bold">Datenschutzerklärung</h1>
      <h2 className="font-semibold">1. Verantwortlicher</h2>
      <p className="whitespace-pre-line">
        {l.businessName}, {l.owner}
        {"\n"}
        {l.address}
        {"\n"}E-Mail: {l.email}
      </p>
      <h2 className="font-semibold">2. Hosting</h2>
      <p>
        Diese App wird auf Servern in der EU betrieben. Beim Aufruf werden technisch notwendige Daten
        (z. B. IP-Adresse, Zeitpunkt) verarbeitet (Art. 6 Abs. 1 lit. f DSGVO). Es werden keine
        Tracking-Cookies verwendet.
      </p>
      <h2 className="font-semibold">3. Kontaktformular</h2>
      <p>
        Wenn Sie uns über das Kontaktformular schreiben, verarbeiten wir Name, E-Mail und Nachricht zur
        Bearbeitung Ihrer Anfrage (Art. 6 Abs. 1 lit. a und b DSGVO). Die Daten werden gelöscht, sobald
        sie nicht mehr erforderlich sind.
      </p>
      <h2 className="font-semibold">4. Ihre Rechte</h2>
      <p>
        Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit,
        Widerspruch sowie Beschwerde bei einer Datenschutz-Aufsichtsbehörde.
      </p>
    </main>
  );
}
