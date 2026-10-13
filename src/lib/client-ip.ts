import { createHmac } from "node:crypto";
import { isIP } from "node:net";

// Client IP for abuse limits. Only a keyed hash is ever stored (GDPR: no plain IP addresses).
//
// Behind a reverse proxy (e.g. Traefik in Coolify) the client address is the entry the proxy
// appended to X-Forwarded-For – the right-most one for a single proxy. Entries further left can be
// set by the client and are ignored. TRUST_PROXY_HOPS = number of proxies in front of the app
// (default 1); 0 = no proxy, X-Forwarded-For is not trusted at all.

export function clientIp(headers: Headers): string | null {
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  if (!Number.isInteger(hops) || hops <= 0) return null;
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = forwarded.length ? forwarded[Math.max(0, forwarded.length - hops)] : headers.get("x-real-ip")?.trim();
  return ip && isIP(stripPort(ip)) ? stripPort(ip) : null;
}

function stripPort(ip: string) {
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
  if (v4WithPort) return v4WithPort[1];
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  return bracketed ? bracketed[1] : ip;
}

/** IPv4 as is; IPv6 reduced to its /64 network, because one connection usually gets a whole /64. */
export function ipNetwork(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  if (isIP(ip) !== 6) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g || "0", 16).toString(16))
    .join(":")}::/64`;
}

/** Keyed hash of the client's network; null when the address is unknown. */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(`ip:${ipNetwork(ip)}`).digest("hex").slice(0, 32);
}
