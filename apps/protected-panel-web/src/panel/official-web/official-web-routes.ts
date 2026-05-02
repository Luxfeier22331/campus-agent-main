import type { Identifier } from "react-admin";

export function buildOfficialWebRunShowPath(runId: Identifier): string {
	return `/officialWebRuns/${encodeURIComponent(String(runId))}/show`;
}

export function buildOfficialWebSiteShowPath(siteId: Identifier): string {
	return `/officialWebSites/${encodeURIComponent(String(siteId))}/show`;
}

export function buildOfficialWebTargetJobShowPath(jobId: Identifier): string {
	return `/officialWebTargetJobs/${encodeURIComponent(String(jobId))}/show`;
}

export function buildOfficialWebReleaseTaskShowPath(taskId: Identifier): string {
	return `/officialWebReleaseTasks/${encodeURIComponent(String(taskId))}/show`;
}
