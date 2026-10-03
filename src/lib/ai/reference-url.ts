// Reference URLs from the "Create with AI" form. Used on the client (normalise on blur) and the
// server (validation). Only public http(s) addresses are accepted – no localhost, IPs or internal
// names – so a later fetch of the page can never be pointed at our own infrastructure.

export const MAX_REFERENCE_URL_LENGTH = 500;

/** "meinbaecker.de" → "https://meinbaecker.de/". Returns null if it is not a usable public URL. */
export function normalizeReferenceUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > MAX_REFERENCE_URL_LENGTH) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return null; // raw IPv4 / IPv6
  url.hash = "";
  return url.href;
}
