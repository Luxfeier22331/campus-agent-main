import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { writeLocalChunkRun } from "../src/artifacts.ts";
import { buildNoticeChunks } from "../src/chunking.ts";
import {
	placeNoticeQuestionEvidence,
	runLocalNoticeChunkComparison,
} from "../src/comparison.ts";
import { runLocalNoticeEmbeddingEvaluation } from "../src/embedding-evaluation.ts";
import { sha256 } from "../src/encoding.ts";
import { parseLocalChunkComparisonCommand } from "../src/local-chunk-comparison-cli.ts";
import { buildValidationReport, selectReviewSamples } from "../src/report.ts";
import type { BuiltNoticeChunks, NoticeChunk, NoticeSource, Sha256Ref } from "../src/types.ts";
import { assertValidNoticeChunks, storedNoticeChunk } from "../src/validation.ts";

describe("notice chunk comparison", () => {
	it("compares chunk placement and text-based embedding ranks for one question file", async () => {
		const root = await mkdtemp(join(tmpdir(), "notice-chunk-comparison-"));
		try {
			const source: NoticeSource = {
				contentText: "时间：4月1日 9:00\n地点：丰台校区礼堂",
				noticeId: "1",
				title: "活动通知",
			};
			const baseline = await writeBuild(
				root,
				buildNoticeChunks(source, {
					algorithm: "notice_comparison_baseline.v1",
					maxChars: 1200,
					overlapChars: 0,
					targetChars: 1,
				}),
			);
			const candidate = await writeBuild(root, buildNoticeChunks(source));
			const questionFile = join(root, "questions.ndjson");
			await writeFile(
				questionFile,
				`${JSON.stringify({
					answer: "4月1日9:00，在丰台校区礼堂",
					evidence: [{ text: "时间：4月1日 9:00" }, { text: "地点：丰台校区礼堂" }],
					noticeId: "1",
					question: "活动通知的时间和地点是什么？",
					questionId: "notice:1:1",
					stratum: "test",
				})}\n`,
			);
			const embedding = {
				async embed(input: { dimensions: number; texts: string[] }): Promise<number[][]> {
					return input.texts.map((text) => {
						const vector = Array(input.dimensions).fill(0) as number[];
						if (text.startsWith("Instruct:") || (text.includes("时间：") && text.includes("地点："))) {
							vector[0] = 1;
						} else if (text.includes("时间：")) {
							vector[0] = 0.9;
							vector[1] = 0.1;
						} else {
							vector[0] = 0.8;
							vector[1] = 0.2;
						}
						return vector;
					});
				},
			};
			const modelTargetSha256 = "a".repeat(64);
			const baselineEvaluation = await runLocalNoticeEmbeddingEvaluation({
				artifactRoot: root,
				chunkRun: baseline.run,
				embedding,
				modelTargetSha256,
				questionFile,
			});
			const candidateEvaluation = await runLocalNoticeEmbeddingEvaluation({
				artifactRoot: root,
				chunkRun: candidate.run,
				embedding,
				modelTargetSha256,
				questionFile,
			});

			const result = await runLocalNoticeChunkComparison({
				artifactRoot: root,
				baselineChunkRun: baseline.run,
				baselineEvaluation: baselineEvaluation.run,
				candidateChunkRun: candidate.run,
				candidateEvaluation: candidateEvaluation.run,
				questionFile,
			});

			expect(result.report.chunkDelta.chunkCount).toEqual({
				baseline: 2,
				candidate: 1,
				delta: -1,
			});
			expect(result.report.questions[0]).toMatchObject({
				baseline: {
					placement: { allEvidenceInSingleChunk: false },
					ranking: { answerEvidenceRank: 2, singleChunkAnswerRank: null },
				},
				candidate: {
					placement: { allEvidenceInSingleChunk: true },
					ranking: { answerEvidenceRank: 1, singleChunkAnswerRank: 1 },
				},
				placementChanged: true,
				rankChange: { answerEvidenceRank: -1 },
			});
			expect(result.report.embedding.overall.mean.meanAnswerReciprocalRank).toEqual({
				baseline: 0.5,
				candidate: 1,
				delta: 0.5,
			});
			expect(result.report.questionSummary.singleChunkEvidenceQuestionCount).toEqual({
				baseline: 0,
				candidate: 1,
				delta: 1,
			});
			expect(
				sha256(await readFile(join(result.outputDirectory, "comparison.json"))),
			).toBe(result.run);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	it("locates evidence by notice and text even when a stale chunk ID is present", () => {
		const chunks: NoticeChunk[] = [
			chunk("a", 0, "1", "时间：4月1日 9:00\n地点：丰台校区礼堂"),
			chunk("b", 0, "2", "时间：4月1日 9:00\n地点：其他地点"),
		];

		expect(
			placeNoticeQuestionEvidence(chunks, {
				answer: "4月1日9:00，在丰台校区礼堂",
				evidence: [
					{ chunkId: `sha256:${"f".repeat(64)}` as Sha256Ref, text: "时间：4月1日 9:00" },
					{ text: "地点：丰台校区礼堂" },
				],
				noticeId: "1",
				question: "活动通知的时间和地点是什么？",
				questionId: "notice:1:1",
				stratum: "test",
			}),
		).toEqual({
			allEvidenceInSingleChunk: true,
			evidenceChunkIndexes: [0],
			evidenceChunkIndexesByEvidence: [[0], [0]],
			missingEvidenceCount: 0,
		});
	});

	it("parses the two chunk runs, two evaluations, and one question file", () => {
		const baselineChunkRun = `sha256:${"a".repeat(64)}`;
		const candidateChunkRun = `sha256:${"b".repeat(64)}`;
		const baselineEvaluation = `sha256:${"c".repeat(64)}`;
		const candidateEvaluation = `sha256:${"d".repeat(64)}`;
		const command = parseLocalChunkComparisonCommand([
			"--baseline-chunk-run",
			baselineChunkRun,
			"--candidate-chunk-run",
			candidateChunkRun,
			"--baseline-evaluation",
			baselineEvaluation,
			"--candidate-evaluation",
			candidateEvaluation,
			"--questions",
			"var/notices/questions.ndjson",
		]);

		expect(command).toEqual({
			baselineChunkRun,
			baselineEvaluation,
			candidateChunkRun,
			candidateEvaluation,
			questionFile: join(
				fileURLToPath(new URL("../../../", import.meta.url)),
				"var/notices/questions.ndjson",
			),
		});
	});
});

async function writeBuild(root: string, build: BuiltNoticeChunks) {
	assertValidNoticeChunks(build);
	return writeLocalChunkRun({
		artifactRoot: root,
		chunks: build.chunks.map(storedNoticeChunk),
		definition: build.definition,
		reviewSamples: selectReviewSamples([build]),
		validation: buildValidationReport([build]),
	});
}

function chunk(
	idCharacter: string,
	chunkIndex: number,
	noticeId: string,
	content: string,
): NoticeChunk {
	return {
		chunkId: `sha256:${idCharacter.repeat(64)}` as Sha256Ref,
		chunkIndex,
		content,
		headingPath: [],
		noticeId,
		retrievalText: content,
	};
}
