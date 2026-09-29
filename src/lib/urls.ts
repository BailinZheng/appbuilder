/** Public address of a customer app, e.g. http://baeckerei.localhost:3000 or https://baeckerei.yourplatform.de */
export function appUrl(slug: string) {
  const root = process.env.ROOT_DOMAIN ?? "localhost";
  const local = root === "localhost";
  const port = process.env.PUBLIC_PORT ?? (local ? "3000" : "");
  return `${local ? "http" : "https"}://${slug}.${root}${port ? `:${port}` : ""}`;
}
