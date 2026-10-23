import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { writeImmutable } from "../artifacts.ts";
import { buildNoticeChunkComparison } from "./build.ts";
import type { LocalNoticeChunkComparisonResult } from "./model.ts";
import { decodeNoticeQuestionNdjson } from "../embedding-evaluation/inputs.ts";
import { readNoticeEmbeddingEvaluation } from "../embedding-evaluation/artifacts.ts";
import { canonicalJsonBytes, sha256 } from "../encoding.ts";
import { artifactHex, readNoticeChunkRun } from "../run-reader.ts";
import type { Sha256Ref } from "../types.ts";

export async function runLocalNoticeChunkComparison(input: {
	artifactRoot: string;
	baselineChunkRun: Sha256Ref;
	baselineEvaluation: Sha256Ref;
	candidateChunkRun: Sha256Ref;
	candidateEvaluation: Sha256Ref;
	questionFile: string;
}): Promise<LocalNoticeChunkComparisonResult> {
	const [baseline, candidate, baselineEvaluation, candidateEvaluation, questionBytes] =
		await Promise.all([
			readNoticeChunkRun(input.artifactRoot, input.baselineChunkRun),
			readNoticeChunkRun(input.artifactRoot, input.candidateChunkRun),
			readNoticeEmbeddingEvaluation(input.artifactRoot, input.baselineEvaluation),
			readNoticeEmbeddingEvaluation(input.artifactRoot, input.candidateEvaluation),
			readFile(input.questionFile),
		]);
	const questions = decodeNoticeQuestionNdjson(questionBytes);
	const questionFileSha256 = sha256(questionBytes);
	const report = buildNoticeChunkComparison({
		baseline,
		baselineChunkRun: input.baselineChunkRun,
		baselineEvaluation,
		candidate,
		candidateChunkRun: input.candidateChunkRun,
		candidateEvaluation,
		questionFileSha256,
		questions,
	});
	const reportBytes = canonicalJsonBytes(report);
	const run = sha256(reportBytes);
	const outputDirectory = join(
		input.artifactRoot,
		"notices",
		"chunking",
		"comparisons",
		"sha256",
		artifactHex(run),
	);
	await mkdir(outputDirectory, { recursive: true });
	await writeImmutable(join(outputDirectory, "comparison.json"), reportBytes);
	return { outputDirectory, report, run };
}
