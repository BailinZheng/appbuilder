"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AppRenderer } from "@/components/AppRenderer";
import {
  BLOCK_LABELS,
  legalComplete,
  newBlock,
  type AppDefinition,
  type Block,
  type BlockType,
  type LegalInfo,
} from "@/lib/app-definition";
import type { App } from "@/db/schema";
import { deleteApp, saveApp, setPublished } from "../../actions";

type Tab = "content" | "design" | "legal";
const input = "w-full rounded-lg border px-3 py-2 text-sm";

export function Editor({ app, publicUrl, submissionCount }: { app: App; publicUrl: string; submissionCount: number }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("content");
  const [name, setName] = useState(app.name);
  const [themeColor, setThemeColor] = useState(app.themeColor);
  const [definition, setDefinition] = useState<AppDefinition>(app.definition);
  const [legal, setLegal] = useState<LegalInfo>(app.legal);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const touch = () => setDirty(true);
  const blocks = definition.blocks;
  const setBlocks = (b: Block[]) => {
    setDefinition({ ...definition, blocks: b });
    touch();
  };
  const updateBlock = (i: number, patch: Partial<Block>) =>
    setBlocks(blocks.map((b, j) => (j === i ? ({ ...b, ...patch } as Block) : b)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  };

  const save = () =>
    start(async () => {
      const res = await saveApp(app.id, { name, themeColor, definition, legal });
      if (res.error) return setMessage(`Error: ${res.error}`);
      setDirty(false);
      setMessage(res.unpublished ? "Saved – app was unpublished because the Impressum is incomplete." : "Saved ✓");
      router.refresh();
    });

  const togglePublish = () =>
    start(async () => {
      if (dirty) return setMessage("Please save your changes first.");
      const res = await setPublished(app.id, !app.published);
      setMessage(res.error ?? (app.published ? "Unpublished." : "Published ✓"));
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/dashboard" className="text-sm text-zinc-500">← All apps</Link>
          <h1 className="text-2xl font-bold">{name}</h1>
          <p className="text-sm text-zinc-500">
            {app.published ? (
              <a href={publicUrl} target="_blank" className="underline">{publicUrl}</a>
            ) : (
              "Draft – not published"
            )}
            {" · "}
            <Link href={`/dashboard/apps/${app.id}/submissions`} className="underline">
              Messages ({submissionCount})
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {message && <span className="text-sm text-zinc-600">{message}</span>}
          <button onClick={save} disabled={pending || !dirty} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            Save
          </button>
          <button onClick={togglePublish} disabled={pending} className="rounded-lg border px-4 py-2 text-sm font-medium">
            {app.published ? "Unpublish" : "Publish"}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        {/* Left: settings */}
        <div className="space-y-4">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm">
            {(["content", "design", "legal"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-md py-1.5 capitalize ${tab === t ? "bg-white shadow-sm" : "text-zinc-600"}`}
              >
                {t === "legal" ? `Impressum${legalComplete(legal) ? "" : " ⚠"}` : t}
              </button>
            ))}
          </div>

          {tab === "content" && (
            <div className="space-y-3">
              {blocks.map((b, i) => (
                <div key={b.id} className="rounded-xl border bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase text-zinc-500">{BLOCK_LABELS[b.type]}</span>
                    <div className="flex gap-1 text-sm">
                      <button onClick={() => move(i, -1)} className="rounded px-2 hover:bg-zinc-100" aria-label="Move up">↑</button>
                      <button onClick={() => move(i, 1)} className="rounded px-2 hover:bg-zinc-100" aria-label="Move down">↓</button>
                      <button onClick={() => setBlocks(blocks.filter((_, j) => j !== i))} className="rounded px-2 text-red-600 hover:bg-red-50" aria-label="Delete">✕</button>
                    </div>
                  </div>
                  <BlockFields block={b} onChange={(p) => updateBlock(i, p)} />
                </div>
              ))}
              <div className="rounded-xl border border-dashed p-3">
                <p className="mb-2 text-xs font-semibold uppercase text-zinc-500">Add block</p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(BLOCK_LABELS) as BlockType[]).map((t) => (
                    <button key={t} onClick={() => setBlocks([...blocks, newBlock(t)])} className="rounded-lg border bg-white px-2.5 py-1 text-sm hover:bg-zinc-50">
                      + {BLOCK_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "design" && (
            <div className="space-y-3 rounded-xl border bg-white p-4">
              <Field label="App name">
                <input value={name} onChange={(e) => { setName(e.target.value); touch(); }} className={input} />
              </Field>
              <Field label="Brand colour">
                <input type="color" value={themeColor} onChange={(e) => { setThemeColor(e.target.value); touch(); }} className="h-10 w-20" />
              </Field>
              <hr />
              <button
                onClick={() => confirm("Delete this app and all its messages permanently?") && start(() => deleteApp(app.id))}
                className="text-sm text-red-600 underline"
              >
                Delete app
              </button>
            </div>
          )}

          {tab === "legal" && (
            <div className="space-y-3 rounded-xl border bg-white p-4">
              <p className="text-sm text-zinc-600">
                Every business website in Germany needs an Impressum (§ 5 DDG). Required fields are marked *.
              </p>
              {(
                [
                  ["businessName", "Business name *"],
                  ["owner", "Owner / legal representative *"],
                  ["address", "Address *"],
                  ["email", "E-mail *"],
                  ["phone", "Phone"],
                  ["vatId", "VAT ID (USt-IdNr.)"],
                ] as [keyof LegalInfo, string][]
              ).map(([k, label]) => (
                <Field key={k} label={label}>
                  {k === "address" ? (
                    <textarea rows={3} value={legal[k]} onChange={(e) => { setLegal({ ...legal, [k]: e.target.value }); touch(); }} className={input} />
                  ) : (
                    <input value={legal[k]} onChange={(e) => { setLegal({ ...legal, [k]: e.target.value }); touch(); }} className={input} />
                  )}
                </Field>
              ))}
            </div>
          )}
        </div>

        {/* Right: live phone preview */}
        <div className="flex justify-center">
          <div className="h-[720px] w-[375px] overflow-auto rounded-[2rem] border-8 border-zinc-900 bg-white shadow-xl">
            <AppRenderer name={name} themeColor={themeColor} definition={definition} base="#" slug={app.slug} preview />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-zinc-600">{label}</span>
      {children}
    </label>
  );
}

function BlockFields({ block: b, onChange }: { block: Block; onChange: (p: Partial<Block>) => void }) {
  const text = (key: string, label: string, value: string, multiline = false) => (
    <Field label={label}>
      {multiline ? (
        <textarea rows={4} value={value} onChange={(e) => onChange({ [key]: e.target.value } as Partial<Block>)} className={input} />
      ) : (
        <input value={value} onChange={(e) => onChange({ [key]: e.target.value } as Partial<Block>)} className={input} />
      )}
    </Field>
  );
  switch (b.type) {
    case "hero":
      return <div className="space-y-2">{text("title", "Title", b.title)}{text("subtitle", "Subtitle", b.subtitle)}</div>;
    case "text":
      return <div className="space-y-2">{text("heading", "Heading", b.heading)}{text("body", "Text", b.body, true)}</div>;
    case "image":
      return <div className="space-y-2">{text("url", "Image URL (https://…)", b.url)}{text("alt", "Description (alt text)", b.alt)}</div>;
    case "button":
      return <div className="space-y-2">{text("label", "Label", b.label)}{text("href", "Link (https://…, tel:…, mailto:…)", b.href)}</div>;
    case "hours":
      return <div className="space-y-2">{text("title", "Title", b.title)}{text("lines", "Hours (one per line)", b.lines, true)}</div>;
    case "contact":
      return <div className="space-y-2">{text("title", "Title", b.title)}{text("submitLabel", "Button text", b.submitLabel)}</div>;
  }
}
