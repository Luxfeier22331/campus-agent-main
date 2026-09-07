import type { Pool } from "pg";

import { writeLocalChunkRun, writeStoredChunkRun } from "./artifacts.ts";
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
	StoredChunkRunResult,
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
	definition?: NoticeChunkDefinition;
	pool: Pick<Pool, "connect">;
}): Promise<StoredChunkRunResult> {
	const sources = await loadPublishedNoticeSources(input.pool);
	const run = buildNoticeChunkRun({
		...(input.definition ? { definition: input.definition } : {}),
		sources,
	});
	return writeStoredChunkRun({ artifactStore: input.artifactStore, ...run });
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
