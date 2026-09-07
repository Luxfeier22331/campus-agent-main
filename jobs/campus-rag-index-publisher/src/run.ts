import { createPostgresIndexCatalog } from "./catalog.ts";
import { createQdrantClient } from "./qdrant.ts";
import { publishCampusRagIndex } from "./publisher.ts";
import type { ReaderObjectStore, Sha256Ref, UnifiedPublishResult } from "./types.ts";

export interface CampusRagPublishRunInput {
	artifactStore: ReaderObjectStore;
	docsEmbeddingSet: Sha256Ref;
	env?: NodeJS.ProcessEnv;
	noticeEmbeddingSet: Sha256Ref;
	onEvent?: (value: Record<string, unknown>) => void;
}

export async function runCampusRagPublish(
	input: CampusRagPublishRunInput,
): Promise<UnifiedPublishResult> {
	const env = input.env ?? process.env;
	const emit = input.onEvent ?? (() => undefined);
	const catalog = createPostgresIndexCatalog(env);
	try {
		await catalog.acquirePublisherLock();
		emit({
			docs_embedding_set: input.docsEmbeddingSet,
			notice_embedding_set: input.noticeEmbeddingSet,
			stage: "publish",
			status: "started",
		});
		return await publishCampusRagIndex({
			artifactStore: input.artifactStore,
			catalog,
			docsEmbeddingSet: input.docsEmbeddingSet,
			noticeEmbeddingSet: input.noticeEmbeddingSet,
			onPublishProgress(stage) {
				emit({ stage: `publish:${stage}`, status: "running" });
			},
			qdrant: createQdrantClient(env),
		});
	} finally {
		await catalog.close();
	}
}
