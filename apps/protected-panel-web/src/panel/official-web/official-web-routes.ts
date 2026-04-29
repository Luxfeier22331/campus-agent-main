import type { Identifier } from "react-admin";

export function buildOfficialWebRunShowPath(runId: Identifier): string {
  return `/officialWebRuns/${encodeURIComponent(String(runId))}/show`;
}

export function buildOfficialWebSiteShowPath(siteId: Identifier): string {
  return `/officialWebSites/${encodeURIComponent(String(siteId))}/show`;
}
