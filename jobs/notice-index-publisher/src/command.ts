import type { Pool } from "pg";

import { writeLocalChunkRun, writeStoredNoticeChunks } from "./artifacts.ts";
import { buildNoticeChunks } from "./chunking/index.ts";
import {
	NOTICE_CHUNK_DEFINITION,
	type NoticeChunkDefinition,
} from "./definitions.ts";
import { buildValidationReport, selectReviewSamples } from "./report/index.ts";
import {
	loadPublishedNoticeSources,
	sortNoticeSources,
} from "./source.ts";
import type {
	LocalChunkRunResult,
	NoticeArtifactStore,
	NoticeChunk,
	NoticeChunkValidationReport,
	NoticeReviewSample,
	NoticeSource,
	StoredNoticeChunksResult,
} from "./types.ts";
import { assertValidChunkRun, storedNoticeChunk } from "./validation.ts";

export async function runLocalNoticeChunkBuild(input: {
	artifactRoot: string;
	definition?: NoticeChunkDefinition;
	pool: Pick<Pool, "connect">;
}): Promise<LocalChunkRunResult> {
	const sources = await loadPublishedNoticeSources(input.pool);
	return buildLocalNoticeChunkRun({
		artifactRoot: input.artifactRoot,
		...(input.definition ? { definition: input.definition } : {}),
		sources,
	});
}

export async function buildLocalNoticeChunkRun(input: {
	artifactRoot: string;
	definition?: NoticeChunkDefinition;
	sources: readonly NoticeSource[];
}): Promise<LocalChunkRunResult> {
	const run = buildNoticeChunkRun(input);
	return writeLocalChunkRun({ artifactRoot: input.artifactRoot, ...run });
}

export async function runStoredNoticeChunkBuild(input: {
	artifactStore: NoticeArtifactStore;
	signal?: AbortSignal;
	definition?: NoticeChunkDefinition;
	pool: Pick<Pool, "connect">;
}): Promise<StoredNoticeChunksResult> {
	const sources = await loadPublishedNoticeSources(input.pool, input.signal);
	input.signal?.throwIfAborted();
	const builds = sortNoticeSources(sources).map((source) => buildNoticeChunks(source, input.definition));
	assertValidChunkRun(builds);
	return writeStoredNoticeChunks({
		artifactStore: input.artifactStore,
		chunks: builds.flatMap((build) => build.chunks.map(storedNoticeChunk)),
	});
}

export function buildNoticeChunkRun(input: {
	definition?: NoticeChunkDefinition;
	sources: readonly NoticeSource[];
}): {
	chunks: NoticeChunk[];
	definition: NoticeChunkDefinition;
	reviewSamples: NoticeReviewSample[];
	validation: NoticeChunkValidationReport;
} {
	const sources = sortNoticeSources(input.sources);
	const definition = input.definition ?? NOTICE_CHUNK_DEFINITION;
	const builds = sources.map((source) => buildNoticeChunks(source, definition));
	assertValidChunkRun(builds);
	const validation = buildValidationReport(builds);
	return {
		chunks: builds.flatMap((build) => build.chunks.map(storedNoticeChunk)),
		definition,
		reviewSamples: selectReviewSamples(builds),
		validation,
	};
}
