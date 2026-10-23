import { optionalBoundedSearchString } from "./ops-view-helpers";

export interface DiningReportsSearch {
	targetType?: "review" | "submission" | undefined;
	submissionId?: string | undefined;
	status?: "pending" | "resolved" | undefined;
	cursor?: string | undefined;
	history?: string | undefined;
	selected?: string | undefined;
}

export function readDiningReportsSearch(search: Record<string, unknown>): DiningReportsSearch {
	return {
		targetType:
			search.targetType === "review" || search.targetType === "submission"
				? search.targetType
				: undefined,
		submissionId: optionalBoundedSearchString(search.submissionId, 200),
		status: search.status === "pending" || search.status === "resolved" ? search.status : undefined,
		cursor: optionalBoundedSearchString(search.cursor, 512),
		history: optionalBoundedSearchString(search.history, 16000),
		selected: optionalBoundedSearchString(search.selected, 200),
	};
}

export function reportReturnSearch(from: string | undefined): DiningReportsSearch | undefined {
	if (!from) {
		return undefined;
	}
	try {
		const url = new URL(from, "https://ops-web.local");
		return url.origin === "https://ops-web.local" && url.pathname === "/dining/reports"
			? readDiningReportsSearch(Object.fromEntries(url.searchParams))
			: undefined;
	} catch {
		return undefined;
	}
}
