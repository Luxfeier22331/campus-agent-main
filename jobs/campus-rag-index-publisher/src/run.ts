import { createPostgresIndexCatalog } from "./catalog.ts";
import { createQdrantClient } from "./qdrant.ts";
import { publishCampusRagIndex } from "./publisher.ts";
import type { ReaderObjectStore, Sha256Ref, UnifiedPublishResult } from "./types.ts";

export interface CampusRagPublishRunInput {
	artifactStore: ReaderObjectStore;
	expectedCurrent?: string | null;
	producer?: "manual" | "automatic";
	producerRunId?: string;
	signal?: AbortSignal;
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
        const signal = AbortSignal.any([catalog.signal, ...(input.signal ? [input.signal] : [])]);
		emit({
			docs_embedding_set: input.docsEmbeddingSet,
			notice_embedding_set: input.noticeEmbeddingSet,
			stage: "publish",
			status: "started",
		});
		return await publishCampusRagIndex({
			artifactStore: input.artifactStore,
			...(input.expectedCurrent !== undefined ? { expectedCurrent: input.expectedCurrent } : {}),
			...(input.producer ? { producer: input.producer } : {}),
			...(input.producerRunId ? { producerRunId: input.producerRunId } : {}),
			signal,
			catalog,
			docsEmbeddingSet: input.docsEmbeddingSet,
			noticeEmbeddingSet: input.noticeEmbeddingSet,
			onPublishProgress(stage) {
				emit({ stage: `publish:${stage}`, status: "running" });
			},
			qdrant: createQdrantClient(env, (url, init) => fetch(url, { ...init, signal })),
		});
	} finally {
		await catalog.close();
	}
}

export interface CampusRagRollbackRunInput {
	collection: string;
	expectedCurrent: string;
	signal?: AbortSignal;
	env?: NodeJS.ProcessEnv;
}

export async function runCampusRagRollback(
	input: CampusRagRollbackRunInput,
): Promise<Pick<UnifiedPublishResult, "collection" | "noOp" | "obsolete">> {
	const catalog = createPostgresIndexCatalog(input.env ?? process.env);
	try {
		await catalog.acquirePublisherLock();
		const signal = AbortSignal.any([catalog.signal, ...(input.signal ? [input.signal] : [])]);
		signal.throwIfAborted();
		const result = await catalog.activate({
			collection: input.collection,
			expectedCurrent: input.expectedCurrent,
		});
		return { collection: input.collection, ...result };
	} finally {
		await catalog.close();
	}
}
