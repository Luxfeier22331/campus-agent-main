import {
	ArtifactValidationError,
	createOpenAICompatibleEmbeddingClient,
} from "@campus-agent/embedding-runtime";
import { createNoticeDatabasePool } from "@campus-agent/notice-database";
import { Context, heartbeat } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { collectValidatedArtifactClosure } from "campus-rag-index-publisher/artifact-import";
import { readDocsEmbeddingSet, readNoticeEmbeddingSet } from "campus-rag-index-publisher/artifacts";
import { createPostgresIndexCatalog } from "campus-rag-index-publisher/catalog";
import { assembleCandidate } from "campus-rag-index-publisher/publisher";
import { createQdrantClient } from "campus-rag-index-publisher/qdrant";
import { runCampusRagPublish } from "campus-rag-index-publisher/run";
import type { Sha256Ref } from "campus-rag-index-publisher/types";
import { runStoredNoticeChunkBuild } from "notice-index-publisher/command";
import { fetchNoticeEmbeddingConnection } from "notice-index-publisher/embedding";
import { buildNoticeEmbeddingSet } from "notice-index-publisher/embedding-set";
import { createNoticeS3ArtifactStore } from "notice-index-publisher/object-store";
import { cleanupAutomaticObjects, noticeArtifactKeys } from "./cleanup.ts";
import type { RollbackInput } from "./contracts.ts";
import { connectTemporal } from "./schedule.ts";

export interface PreparedRefresh {
	expectedCurrent: string;
	docsEmbeddingSet: Sha256Ref;
	chunkRun: Sha256Ref;
	modelTargetSha256: string;
	unchanged: boolean;
}

async function activity<T>(
	run: (signal: AbortSignal, report: (progress: unknown) => void) => Promise<T>,
): Promise<T> {
	const signal = Context.current().cancellationSignal;
	let progress: unknown = { stage: Context.current().info.activityType };
	const timer = setInterval(() => heartbeat(progress), 10_000);
	try {
		signal.throwIfAborted();
		return await run(signal, (value) => {
			progress = value;
			heartbeat(value);
		});
	} catch (error) {
		if (error instanceof ArtifactValidationError) {
			throw ApplicationFailure.nonRetryable(error.message, error.name);
		}
		throw error;
	} finally {
		clearInterval(timer);
	}
}
const cancelFetch =
	(signal: AbortSignal): typeof fetch =>
	(url, init) =>
		fetch(url, {
			...init,
			signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
		});

export async function prepareRefresh(): Promise<PreparedRefresh> {
	return activity(async (signal) => {
		const catalog = createPostgresIndexCatalog();
		const store = createNoticeS3ArtifactStore(process.env, {
			signal,
			producerRunId: producingRunId(),
		});
		const pool = createNoticeDatabasePool(process.env, { max: 1 });
		try {
			const { current } = await catalog.current();
			if (!current) {
				throw ApplicationFailure.nonRetryable(
					"No active index; publish verified Docs and Notice artifacts first",
					"MissingActiveIndex",
				);
			}
			const docs = await readDocsEmbeddingSet(store, current.docsEmbeddingSet);
			const connection = await fetchNoticeEmbeddingConnection(cancelFetch(signal));
			if (docs.manifest.modelTargetSha256 !== connection.targetSha256) {
				throw ApplicationFailure.nonRetryable(
					"Docs model target differs from Model Config; explicitly republish Docs",
					"ModelTargetMismatch",
				);
			}
			const previous = await readNoticeEmbeddingSet(store, current.noticeEmbeddingSet);
			const chunks = await runStoredNoticeChunkBuild({ artifactStore: store, pool, signal });
			return {
				expectedCurrent: current.collection,
				docsEmbeddingSet: current.docsEmbeddingSet,
				chunkRun: chunks.run,
				modelTargetSha256: connection.targetSha256,
				unchanged: previous.manifest.chunkRun === chunks.run,
			};
		} finally {
			store.close();
			await pool.end();
			await catalog.close();
		}
	});
}

export async function embedNotices(input: PreparedRefresh) {
	return activity(async (signal, report) => {
		const store = createNoticeS3ArtifactStore(process.env, {
			signal,
			producerRunId: producingRunId(),
		});
		try {
			const connection = await fetchNoticeEmbeddingConnection(cancelFetch(signal));
			if (connection.targetSha256 !== input.modelTargetSha256) {
				throw ApplicationFailure.nonRetryable(
					"Model Config changed during refresh",
					"ModelTargetMismatch",
				);
			}
			return await buildNoticeEmbeddingSet({
				artifactStore: store,
				chunkRun: input.chunkRun,
				embedding: createOpenAICompatibleEmbeddingClient(connection, cancelFetch(signal)),
				modelTargetSha256: input.modelTargetSha256,
				onEmbeddingProgress: (completed, total) => {
					signal.throwIfAborted();
					report({ completed, total });
				},
			});
		} finally {
			store.close();
		}
	});
}

export async function publishRefresh(input: PreparedRefresh & { noticeEmbeddingSet: Sha256Ref }) {
	return activity(async (signal) => {
		const store = createNoticeS3ArtifactStore(process.env, {
			signal,
			producerRunId: producingRunId(),
		});
		try {
			const result = await runCampusRagPublish({
				artifactStore: store,
				docsEmbeddingSet: input.docsEmbeddingSet,
				noticeEmbeddingSet: input.noticeEmbeddingSet,
				expectedCurrent: input.expectedCurrent,
				producer: "automatic",
				producerRunId: producingRunId(),
				signal,
			});
			return {
				outcome: result.obsolete || result.noOp ? ("skipped" as const) : ("success" as const),
				collection: result.collection,
			};
		} finally {
			store.close();
		}
	});
}

export async function cleanupVersions() {
	return activity(async (cancellation) => {
		const catalog = createPostgresIndexCatalog();
		const signal = AbortSignal.any([cancellation, catalog.signal]);
		const store = createNoticeS3ArtifactStore(process.env, { signal });
		const { client, connection } = await connectTemporal();
		try {
			await catalog.acquirePublisherLock();
			const activeRuns = new Set<string>();
			for await (const execution of client.workflow.list({
				query: 'WorkflowType="campusRagRefresh" AND ExecutionStatus="Running"',
			})) {
				activeRuns.add(execution.runId);
			}
			await catalog.retireAbandoned([...activeRuns]);
			const retired = (await catalog.retiredVersions()).filter(
				(version) => !(version.producerRunId && activeRuns.has(version.producerRunId)),
			);
			const retiredIds = new Set(retired.map((version) => version.collection));
			const protectedKeys = new Set<string>();
			for (const version of await catalog.versions()) {
				if (retiredIds.has(version.collection)) {
					continue;
				}
				// Protect available references even when an incomplete candidate reused older objects.
				if (!(version.validated || version.activatedAt) && version.producer === "automatic") {
					for (const key of await noticeArtifactKeys(store, version.noticeEmbeddingSet)) {
						protectedKeys.add(key);
					}
					continue;
				}
				const closure = await collectValidatedArtifactClosure({
					sourceStore: store,
					validate: (reader) =>
						assembleCandidate(reader, version.docsEmbeddingSet, version.noticeEmbeddingSet).then(
							() => undefined,
						),
				});
				for (const object of closure) {
					protectedKeys.add(object.key);
					if (
						object.key.startsWith("notices/rag/chunk-runs/") &&
						object.key.endsWith("/manifest.json")
					) {
						protectedKeys.add(object.key.replace("manifest.json", "validation.json"));
						protectedKeys.add(object.key.replace("manifest.json", "review-samples.ndjson"));
					}
				}
			}
			const retiredClosures = new Map<string, Set<string>>();
			const deferred = new Set<string>();
			const retiredKeys = new Set<string>();
			for (const version of retired) {
				const keys = await noticeArtifactKeys(store, version.noticeEmbeddingSet);
				retiredClosures.set(version.collection, keys);
				for (const key of keys) {
					retiredKeys.add(key);
					const metadata = await store.inspect(key);
					if (metadata.runId && activeRuns.has(metadata.runId)) {
						deferred.add(version.collection);
					}
				}
				if (deferred.has(version.collection)) {
					for (const key of keys) {
						protectedKeys.add(key);
					}
				}
			}
			const qdrant = createQdrantClient(process.env, cancelFetch(signal));
			for (const version of retired) {
				signal.throwIfAborted();
				if (
					!deferred.has(version.collection) &&
					(await qdrant.collectionExists(version.collection))
				) {
					await qdrant.deleteCollection(version.collection);
				}
			}
			const objectsDeleted = await cleanupAutomaticObjects({
				store,
				protectedKeys,
				retiredKeys,
				activeRunIds: activeRuns,
			});

			const remaining = new Set(await store.list("notices/rag/"));
			let deleted = 0;
			for (const version of retired) {
				let pending = deferred.has(version.collection);
				for (const key of retiredClosures.get(version.collection) ?? []) {
					if (!remaining.has(key) || protectedKeys.has(key)) {
						continue;
					}
					const metadata = await store.inspect(key);
					if (metadata.runId) {
						pending = true;
					}
				}
				if (!pending) {
					await catalog.removeRetired(version.collection);
					deleted += 1;
				}
			}
			return { outcome: "success" as const, deleted, objectsDeleted };
		} finally {
			store.close();
			await catalog.close();
			await connection.close();
		}
	});
}

export async function rollbackIndex(input: RollbackInput) {
	return activity(async (signal) => {
		const store = createNoticeS3ArtifactStore(process.env, { signal });
		try {
			return await runCampusRagPublish({
				artifactStore: store,
				docsEmbeddingSet: input.docsEmbeddingSet,
				noticeEmbeddingSet: input.noticeEmbeddingSet,
				expectedCurrent: input.expectedCurrent,
				producer: input.producer,
				...(input.producerRunId ? { producerRunId: input.producerRunId } : {}),
				signal,
			});
		} finally {
			store.close();
		}
	});
}

function producingRunId(): string {
	const execution = Context.current().info.workflowExecution;
	if (!execution) {
		throw new Error("Campus RAG activities require a workflow execution");
	}
	return execution.runId;
}
