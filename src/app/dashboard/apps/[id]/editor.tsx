"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AppRenderer } from "@/components/AppRenderer";
import { useI18n } from "@/i18n/client";
import type { Dictionary } from "@/i18n/dictionaries";
import {
  BLOCK_TYPES,
  legalComplete,
  newBlock,
  type AppDefinition,
  type Block,
  type LegalInfo,
} from "@/lib/app-definition";
import type { App } from "@/db/schema";
import { formatDate } from "@/i18n/format";
import { hostingStatus } from "@/lib/billing/hosting";
import { deleteApp, saveApp, setPublished } from "../../actions";
import { ImageDropzone } from "@/components/ImageDropzone";
import { AiPanel } from "./ai-panel";

type Tab = "ai" | "content" | "design" | "legal";
// Status messages are stored as keys so they re-render in the new language after a switch.
type StatusKey = "saved" | "savedUnpublished" | "saveFirst" | "published" | "unpublished";
type Status = { key: StatusKey } | { error: string } | { hostingRequired: true };

const input = "w-full rounded-lg border px-3 py-2 text-sm";
const LEGAL_KEYS: (keyof LegalInfo)[] = ["businessName", "owner", "address", "email", "phone", "vatId"];

type EditorProps = {
  app: App;
  publicUrl: string;
  submissionCount: number;
  balance: number;
  canUndo: boolean;
};

export function Editor({ app, publicUrl, submissionCount, balance, canUndo }: EditorProps) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [tab, setTab] = useState<Tab>("ai");
  const [name, setName] = useState(app.name);
  const [themeColor, setThemeColor] = useState(app.themeColor);
  const [definition, setDefinition] = useState<AppDefinition>(app.definition);
  const [legal, setLegal] = useState<LegalInfo>(app.legal);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
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
      if (res.error) return setStatus({ error: res.error });
      setDirty(false);
      setStatus({ key: res.unpublished ? "savedUnpublished" : "saved" });
      router.refresh();
    });

  const togglePublish = () =>
    start(async () => {
      if (dirty) return setStatus({ key: "saveFirst" });
      const res = await setPublished(app.id, !app.published);
      if ("hostingRequired" in res) return setStatus({ hostingRequired: true });
      setStatus(res.error ? { error: res.error } : { key: app.published ? "unpublished" : "published" });
      router.refresh();
    });

  /** Called after an AI change or undo – the server already saved it. */
  const applySite = (site: { name: string; themeColor: string; definition: AppDefinition }) => {
    setName(site.name);
    setThemeColor(site.themeColor);
    setDefinition(site.definition);
    setDirty(false);
    setStatus(null);
  };

  const hosting = hostingStatus(app.hostedUntil);
  const hostingText =
    hosting.state === "none"
      ? t.billing.hosting.none
      : hosting.state === "active"
        ? t.billing.hosting.active(formatDate(hosting.until, locale))
        : hosting.state === "grace"
          ? t.billing.hosting.grace(formatDate(hosting.offlineAt, locale))
          : t.billing.hosting.lapsed(formatDate(hosting.until, locale));
  const hostingHref = `/dashboard/billing?app=${app.id}#hosting-${app.id}`;

  const statusText =
    status &&
    ("key" in status
      ? t.editor[status.key]
      : "hostingRequired" in status
        ? t.hostingUi.needed
        : `${t.editor.errorPrefix}: ${status.error}`);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/dashboard" className="text-sm text-zinc-500">← {t.editor.allApps}</Link>
          <h1 className="text-2xl font-bold">{name}</h1>
          <p className="text-sm text-zinc-500">
            {app.published ? (
              <a href={publicUrl} target="_blank" className="underline">{publicUrl}</a>
            ) : (
              t.editor.draft
            )}
            {" · "}
            <Link href={`/dashboard/apps/${app.id}/submissions`} className="underline">
              {t.editor.messages} ({submissionCount})
            </Link>
          </p>
          <p className="text-sm">
            <span className={hosting.state === "active" ? "text-green-700" : "text-amber-700"}>{hostingText}</span>
            {" · "}
            <Link href={hostingHref} className="underline">
              {hosting.state === "none" ? t.hostingUi.buy : t.hostingUi.extend}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {statusText && (
            <span className="text-sm text-zinc-600">
              {statusText}
              {status && "hostingRequired" in status && (
                <>
                  {" "}
                  <Link href={hostingHref} className="underline">{t.hostingUi.buy}</Link>
                </>
              )}
            </span>
          )}
          <button onClick={save} disabled={pending || !dirty} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            {t.editor.save}
          </button>
          <button onClick={togglePublish} disabled={pending} className="rounded-lg border px-4 py-2 text-sm font-medium">
            {app.published ? t.editor.unpublish : t.editor.publish}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        {/* Left: settings */}
        <div className="space-y-4">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm">
            {(["ai", "content", "design", "legal"] as Tab[]).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex-1 rounded-md py-1.5 ${tab === k ? "bg-white shadow-sm" : "text-zinc-600"}`}
              >
                {k === "ai" ? `✨ ${t.ai.tab}` : t.editor.tabs[k]}
                {k === "legal" && !legalComplete(legal) && " ⚠"}
              </button>
            ))}
          </div>

          {/* Kept mounted so balance and last result survive tab switches */}
          <div hidden={tab !== "ai"}>
            <AiPanel appId={app.id} initialBalance={balance} initialCanUndo={canUndo} dirty={dirty} onApplied={applySite} />
          </div>

          {tab === "content" && (
            <div className="space-y-3">
              {blocks.map((b, i) => (
                <div key={b.id} className="rounded-xl border bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase text-zinc-500">{t.editor.blocks[b.type]}</span>
                    <div className="flex gap-1 text-sm">
                      <button onClick={() => move(i, -1)} className="rounded px-2 hover:bg-zinc-100" aria-label={t.editor.moveUp}>↑</button>
                      <button onClick={() => move(i, 1)} className="rounded px-2 hover:bg-zinc-100" aria-label={t.editor.moveDown}>↓</button>
                      <button onClick={() => setBlocks(blocks.filter((_, j) => j !== i))} className="rounded px-2 text-red-600 hover:bg-red-50" aria-label={t.editor.deleteBlock}>✕</button>
                    </div>
                  </div>
                  <BlockFields block={b} appId={app.id} f={t.editor.fields} onChange={(p) => updateBlock(i, p)} />
                </div>
              ))}
              <div className="rounded-xl border border-dashed p-3">
                <p className="mb-2 text-xs font-semibold uppercase text-zinc-500">{t.editor.addBlock}</p>
                <div className="flex flex-wrap gap-2">
                  {BLOCK_TYPES.map((type) => (
                    <button key={type} onClick={() => setBlocks([...blocks, newBlock(type, locale)])} className="rounded-lg border bg-white px-2.5 py-1 text-sm hover:bg-zinc-50">
                      + {t.editor.blocks[type]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "design" && (
            <div className="space-y-3 rounded-xl border bg-white p-4">
              <Field label={t.editor.appName}>
                <input value={name} onChange={(e) => { setName(e.target.value); touch(); }} className={input} />
              </Field>
              <Field label={t.editor.brandColour}>
                <input type="color" value={themeColor} onChange={(e) => { setThemeColor(e.target.value); touch(); }} className="h-10 w-20" />
              </Field>
              <hr />
              <button
                onClick={() => confirm(t.editor.confirmDelete) && start(() => deleteApp(app.id))}
                className="text-sm text-red-600 underline"
              >
                {t.editor.deleteApp}
              </button>
            </div>
          )}

          {tab === "legal" && (
            <div className="space-y-3 rounded-xl border bg-white p-4">
              <p className="text-sm text-zinc-600">{t.editor.legalIntro}</p>
              {LEGAL_KEYS.map((k) => (
                <Field key={k} label={t.editor.legalFields[k]}>
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

function BlockFields({
  block: b,
  appId,
  f,
  onChange,
}: {
  block: Block;
  appId: string;
  f: Dictionary["editor"]["fields"];
  onChange: (p: Partial<Block>) => void;
}) {
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
      return <div className="space-y-2">{text("title", f.title, b.title)}{text("subtitle", f.subtitle, b.subtitle)}</div>;
    case "text":
      return <div className="space-y-2">{text("heading", f.heading, b.heading)}{text("body", f.text, b.body, true)}</div>;
    case "image":
      return (
        <div className="space-y-2">
          {/* Not a <label>: a label around the drop area would open the file picker a second time */}
          <div className="space-y-1">
            <span className="text-xs font-medium text-zinc-600">{f.imageUrl}</span>
            <ImageDropzone appId={appId} value={b.url} alt={b.alt} onChange={(url) => onChange({ url })} />
          </div>
          {text("alt", f.alt, b.alt)}
        </div>
      );
    case "button":
      return <div className="space-y-2">{text("label", f.label, b.label)}{text("href", f.link, b.href)}</div>;
    case "hours":
      return <div className="space-y-2">{text("title", f.title, b.title)}{text("lines", f.hours, b.lines, true)}</div>;
    case "contact":
      return <div className="space-y-2">{text("title", f.title, b.title)}{text("submitLabel", f.submitLabel, b.submitLabel)}</div>;
  }
}
