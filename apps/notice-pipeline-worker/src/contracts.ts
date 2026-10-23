export type NoticePipelineMode =
	| "scheduled"
	| "file-sync"
	| "sync"
	| "backfill"
	| "rescan"
	| "classify-one"
	| "classify-all"
	| "publish-one"
	| "republish-one";

export interface NoticePipelineInput {
	mode: NoticePipelineMode;
	noticeIds?: readonly number[];
	startDate?: string;
	from?: string;
	to?: string;
}
