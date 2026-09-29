import { getBase, getPublishedApp } from "../data";

export default async function Impressum({ params }: PageProps<"/s/[slug]/impressum">) {
  const { slug } = await params;
  const app = (await getPublishedApp(slug))!;
  const l = app.legal;
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-5 py-10">
      <a href={`${await getBase(slug)}/`} className="text-sm underline">← {app.name}</a>
      <h1 className="text-2xl font-bold">Impressum</h1>
      <p className="text-sm text-zinc-500">Angaben gemäß § 5 DDG</p>
      <p className="whitespace-pre-line">
        {l.businessName}
        {"\n"}Inhaber: {l.owner}
        {"\n"}
        {l.address}
      </p>
      <p>
        E-Mail: {l.email}
        {l.phone && <><br />Telefon: {l.phone}</>}
        {l.vatId && <><br />USt-IdNr.: {l.vatId}</>}
      </p>
    </main>
  );
}
