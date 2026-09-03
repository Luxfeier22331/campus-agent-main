import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { writeImmutable } from "../artifacts.ts";
import { analyzeNotice, isLogicalNoticeTableLike } from "./analysis.ts";
import { buildReviewCandidates, compactReviewRecord } from "./candidates.ts";
import {
	NOTICE_BROAD_REVIEW_ARTIFACT_DIRECTORY,
	NOTICE_BROAD_REVIEW_DEFINITION,
	type LocalBroadReviewResult,
} from "./model.ts";
import {
	buildBroadReviewCensus,
	selectBroadReviewSample,
} from "./sampling.ts";
import { canonicalJsonBytes, encodeNdjson } from "../encoding.ts";
import { artifactHex, readNoticeChunkRun } from "../run-reader.ts";
import type { Sha256Ref } from "../types.ts";

export {
	NOTICE_BROAD_REVIEW_ARTIFACT_DIRECTORY,
	NOTICE_BROAD_REVIEW_DEFINITION,
	isLogicalNoticeTableLike,
	selectBroadReviewSample,
};
export type { LocalBroadReviewResult } from "./model.ts";

export async function runLocalNoticeBroadReview(input: {
	artifactRoot: string;
	chunkRun: Sha256Ref;
}): Promise<LocalBroadReviewResult> {
	const runData = await readNoticeChunkRun(input.artifactRoot, input.chunkRun);
	const notices = [...runData.chunksByNoticeId.entries()]
		.map(([noticeId, chunks]) => analyzeNotice(noticeId, chunks))
		.sort(compareNoticeIds);
	const { sample, summary } = selectBroadReviewSample(notices);
	const candidates = buildReviewCandidates(sample);
	const outputDirectory = join(
		input.artifactRoot,
		"notices",
		"chunking",
		"reviews",
		"sha256",
		artifactHex(input.chunkRun),
		NOTICE_BROAD_REVIEW_ARTIFACT_DIRECTORY,
	);
	const census = buildBroadReviewCensus(notices, input.chunkRun);
	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeJson(join(outputDirectory, "census.json"), census),
		writeJson(join(outputDirectory, "sample-summary.json"), summary),
		writeNdjson(join(outputDirectory, "broad-sample.ndjson"), sample),
		writeNdjson(
			join(outputDirectory, "review-sheet.ndjson"),
			sample.map(compactReviewRecord),
		),
		writeNdjson(join(outputDirectory, "review-candidates.ndjson"), candidates),
		writeJson(join(outputDirectory, "review-candidates-summary.json"), {
			candidateCount: candidates.length,
			noticeCount: new Set(candidates.map((candidate) => candidate.noticeId)).size,
			signals: Object.fromEntries(
				[...new Set(candidates.map((candidate) => candidate.signal))]
					.sort()
					.map((signal) => [
						signal,
						candidates.filter((candidate) => candidate.signal === signal).length,
					]),
			),
		}),
	]);
	return {
		outputDirectory,
		populationChunkCount: runData.chunks.length,
		populationNoticeCount: notices.length,
		run: input.chunkRun,
		sampleCount: sample.length,
	};
}

function compareNoticeIds(left: { noticeId: string }, right: { noticeId: string }): number {
	const leftNumber = BigInt(left.noticeId);
	const rightNumber = BigInt(right.noticeId);
	return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await writeImmutable(path, canonicalJsonBytes(value));
}

async function writeNdjson(path: string, records: readonly unknown[]): Promise<void> {
	const bytes = records.length === 0 ? new TextEncoder().encode("") : encodeNdjson(records);
	await writeImmutable(path, bytes);
}
