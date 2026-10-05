import { optionalBoundedSearchString } from "./ops-view-helpers";
export interface DiningReviewsSearch {
	visibility?: "visible" | "hidden" | "deleted" | undefined;
	targetType?: "menu_item" | "submission" | undefined;
	menuItemId?: string | undefined;
	submission_id?: string | undefined;
	q?: string | undefined;
	cursor?: string | undefined;
	history?: string | undefined;
	reviewId?: string | undefined;
}
export function readDiningReviewsSearch(search: Record<string, unknown>): DiningReviewsSearch {
	return {
		visibility:
			search.visibility === "hidden" || search.visibility === "deleted"
				? search.visibility
				: "visible",
		targetType:
			search.targetType === "menu_item" || search.targetType === "submission"
				? search.targetType
				: search.submission_id
					? "submission"
					: undefined,
		menuItemId: optionalBoundedSearchString(search.menuItemId, 200),
		submission_id: optionalBoundedSearchString(search.submission_id, 200),
		q: optionalBoundedSearchString(search.q, 256),
		cursor: optionalBoundedSearchString(search.cursor, 512),
		history: optionalBoundedSearchString(search.history, 16000),
		reviewId: optionalBoundedSearchString(search.reviewId, 200),
	};
}
