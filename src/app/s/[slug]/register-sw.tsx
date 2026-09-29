"use client";

import { useEffect } from "react";

/** Registers the shared service worker so every customer app is installable and works offline. */
export function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
