"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { locales, type Locale } from "@/i18n/config";
import { setLocale } from "@/i18n/actions";
import { useI18n } from "@/i18n/client";

/** Gear button in the top-right corner. Currently holds the language switch; more settings can go here later. */
export function SettingsMenu() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (l: Locale) =>
    start(async () => {
      if (l !== locale) {
        await setLocale(l);
        router.refresh();
      }
      setOpen(false);
    });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t.settings.button}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t.settings.button}
        className="flex h-9 items-center gap-1.5 rounded-lg border bg-white px-2.5 text-sm text-zinc-700 hover:bg-zinc-50"
      >
        <GearIcon />
        <span className="font-medium uppercase">{locale}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-48 rounded-xl border bg-white p-1 shadow-lg">
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase text-zinc-500">{t.settings.language}</p>
          {locales.map((l) => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={l === locale}
              disabled={pending}
              onClick={() => choose(l)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 disabled:opacity-60"
            >
              <span>{t.settings.names[l]}</span>
              {l === locale && <span aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
