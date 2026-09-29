/**
 * Development/demo tools: test-credit grants, simulated checkout, unit-economics view.
 * Enabled only with ENABLE_DEV_TOOLS=true in .env – never set this on a real production server.
 */
export function devToolsEnabled() {
  return process.env.ENABLE_DEV_TOOLS === "true";
}
