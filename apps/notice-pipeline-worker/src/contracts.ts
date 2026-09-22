export type NoticePipelineMode =
	| "scheduled"
	| "file-sync"
	| "sync"
	| "backfill"
	| "rescan"
	| "classify-one"
	| "publish-one"
	| "republish-one"
	| "refresh";

export interface NoticePipelineInput {
	mode: NoticePipelineMode;
	noticeIds?: readonly number[];
	startDate?: string;
	from?: string;
	to?: string;
}

export interface RollbackInput {
	expectedCurrent: string;
	docsEmbeddingSet: `sha256:${string}`;
	noticeEmbeddingSet: `sha256:${string}`;
	producer: "automatic" | "manual";
	producerRunId?: string;
}
