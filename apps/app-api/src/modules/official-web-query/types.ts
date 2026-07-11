export type OfficialWebRunIntent = "baseline" | "hot" | "repair";
export type OfficialWebFetchDisposition = "fetched" | "not_modified" | "deleted" | "fetch_failed";
export type OfficialWebPageChangeStatus =
	| "new"
	| "changed"
	| "deleted"
	| "not_modified"
	| "fetch_failed";
