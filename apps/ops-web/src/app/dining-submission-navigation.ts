import type { DiningSubmissionListParams } from "./ops-api/dining";
import { optionalBoundedSearchString } from "./ops-view-helpers";

export interface DiningSubmissionsSearch {
	windowId?: string | undefined;
	status?: DiningSubmissionListParams["status"] | undefined;
	reportStatus?: DiningSubmissionListParams["reportStatus"] | undefined;
	cursor?: string | undefined;
	history?: string | undefined;
}
export function readDiningSubmissionsSearch(
	search: Record<string, unknown>,
): DiningSubmissionsSearch {
	return {
		windowId: optionalBoundedSearchString(search.windowId, 200),
		status: ["public", "hidden", "deleted", "expired", "purged"].includes(String(search.status))
			? (search.status as DiningSubmissionListParams["status"])
			: undefined,
		reportStatus:
			search.reportStatus === "pending" || search.reportStatus === "resolved"
				? search.reportStatus
				: undefined,
		cursor: optionalBoundedSearchString(search.cursor, 512),
		history: optionalBoundedSearchString(search.history, 16000),
	};
}
export function submissionReturnSearch(from: string | undefined): DiningSubmissionsSearch {
	if (!from) {
		return {};
	}
	try {
		const url = new URL(from, "https://ops-web.local");
		return url.origin === "https://ops-web.local" && url.pathname === "/dining/submissions"
			? readDiningSubmissionsSearch(Object.fromEntries(url.searchParams))
			: {};
	} catch {
		return {};
	}
}
