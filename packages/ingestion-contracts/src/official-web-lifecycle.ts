export type OfficialWebRunStatus =
	| "accepted"
	| "running"
	| "completed"
	| "completed_with_errors"
	| "failed"
	| "abandoned";

export type OfficialWebTerminalRunStatus = "completed" | "completed_with_errors" | "failed";
export type OfficialWebRunIntent = "baseline" | "hot" | "repair";

export type OfficialWebIngestionDispatchStatus =
	| "pending"
	| "queued"
	| "dispatched"
	| "ingestion_failed";

export type OfficialWebIngestionExecutionStatus =
	| "pending"
	| "running"
	| "staged"
	| "promoted"
	| "succeeded"
	| "failed";

export type OfficialWebFetchDisposition = "fetched" | "not_modified" | "deleted" | "fetch_failed";

export type OfficialWebPageChangeStatus =
	| "new"
	| "changed"
	| "deleted"
	| "not_modified"
	| "fetch_failed";
