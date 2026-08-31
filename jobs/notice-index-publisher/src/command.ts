import type { Pool } from "pg";

import { writeLocalChunkRun } from "./artifacts.ts";
import { buildNoticeChunks } from "./chunking.ts";
import {
	NOTICE_CHUNK_DEFINITION,
	type NoticeChunkDefinition,
} from "./definitions.ts";
import { buildValidationReport, selectReviewSamples } from "./report.ts";
import { loadPublishedNoticeSources, sortNoticeSources } from "./source.ts";
import type { LocalChunkRunResult, NoticeSource } from "./types.ts";
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
	const sources = sortNoticeSources(input.sources);
	const definition = input.definition ?? NOTICE_CHUNK_DEFINITION;
	const builds = sources.map((source) => buildNoticeChunks(source, definition));
	assertValidChunkRun(builds);
	const validation = buildValidationReport(builds);
	return writeLocalChunkRun({
		artifactRoot: input.artifactRoot,
		chunks: builds.flatMap((build) => build.chunks.map(storedNoticeChunk)),
		definition,
		reviewSamples: selectReviewSamples(builds),
		validation,
	});
}
