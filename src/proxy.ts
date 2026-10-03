import { NextResponse, type NextRequest } from "next/server";

// Multi-tenant routing: <slug>.localhost:3000 (dev) or <slug>.ROOT_DOMAIN (prod)
// is rewritten internally to /s/<slug>/... . Everything else is the platform itself.
const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? "localhost";

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const suffix = `.${ROOT_DOMAIN}`;
  if (!host.endsWith(suffix)) return NextResponse.next();

  const sub = host.slice(0, -suffix.length);
  if (!sub || sub === "www" || sub.includes(".")) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/s/${sub}${url.pathname === "/" ? "" : url.pathname}`;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-app-base", ""); // links inside the app are relative to the subdomain root
  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}

export const config = {
  // Skip Next internals, APIs, uploaded media, the shared service worker and static files.
  matcher: ["/((?!_next/|api/|media/|sw\\.js|favicon\\.ico).*)"],
};
