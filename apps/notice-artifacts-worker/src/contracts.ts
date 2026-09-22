import type { Sha256Ref } from "campus-rag-index-publisher/types";

export interface RollbackInput {
	expectedCurrent: string;
	docsEmbeddingSet: Sha256Ref;
	noticeEmbeddingSet: Sha256Ref;
	producer: "manual" | "automatic";
	producerRunId?: string;
}
