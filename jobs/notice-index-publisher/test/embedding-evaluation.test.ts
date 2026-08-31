import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { computeEmbeddingTargetSha256 } from "@campus-agent/embedding-runtime";

import { buildLocalNoticeChunkRun } from "../src/command.ts";
import {
	evaluateDenseRetrieval,
	formatNoticeQuery,
	runLocalNoticeEmbeddingEvaluation,
} from "../src/embedding-evaluation.ts";
import { parseLocalEmbeddingEvaluationCommand } from "../src/local-embedding-evaluation-cli.ts";
import type { NoticeChunk, Sha256Ref } from "../src/types.ts";

describe("notice embedding evaluation", () => {
	it("uses the fixed notice query instruction and shared target contract", () => {
		expect(formatNoticeQuery("  报名截止时间是什么？  ")).toBe(
			"Instruct: Given a Campus Web notice question, retrieve relevant notice passages that answer the query.\nQuery:报名截止时间是什么？",
		);
		expect(computeEmbeddingTargetSha256("https://embedding.example/v1/")).toBe(
			"16794d2d7d70c3c7f95c416c00e51d3e8d1269614c59acbc9d05eac22d76865d",
		);
	});

	it("resolves repository-relative question files when pnpm changes the package cwd", () => {
		expect(
			parseLocalEmbeddingEvaluationCommand([
				"--chunk-run",
				`sha256:${"a".repeat(64)}`,
				"--questions",
				"var/notices/questions.ndjson",
			]).questionFile,
		).toBe(
			join(
				fileURLToPath(new URL("../../../", import.meta.url)),
				"var/notices/questions.ndjson",
			),
		);
	});

	it("reports target, complete-evidence and notice retrieval separately", () => {
		const first = chunk("a", 0, "1", "第一条事实");
		const second = chunk("b", 0, "2", "第二条前半");
		const third = chunk("c", 1, "2", "第二条后半");
		const result = evaluateDenseRetrieval({
			chunks: [first, second, third],
			documentVectorsByChunkId: new Map([
				[first.chunkId, [1, 0]],
				[second.chunkId, [0.2, 0.8]],
				[third.chunkId, [0, 1]],
			]),
			questions: [
				{
					answer: "第一条事实",
					evidence: [{ chunkId: first.chunkId, text: first.content }],
					noticeId: "1",
					question: "第一条是什么？",
					questionId: "q1",
					stratum: "single",
				},
				{
					answer: "第二条完整答案",
					evidence: [
						{ chunkId: second.chunkId, text: second.content },
						{ chunkId: third.chunkId, text: third.content },
					],
					noticeId: "2",
					question: "第二条完整内容是什么？",
					questionId: "q2",
					stratum: "multi",
				},
			],
			queryVectorsByQuestionId: new Map([
				["q1", [1, 0]],
				["q2", [0, 1]],
			]),
		});

		expect(result.metrics.targetChunkRecallAt).toEqual({
			"1": 1,
			"3": 1,
			"5": 1,
			"10": 1,
		});
		expect(result.metrics.allEvidenceRecallAt).toEqual({
			"1": 0.5,
			"3": 1,
			"5": 1,
			"10": 1,
		});
		expect(result.metrics.noticeRecallAt["1"]).toBe(1);
		expect(result.metrics.singleChunkAnswerQuestionCount).toBe(1);
		expect(result.metrics.singleChunkAnswerRecallAt["1"]).toBe(1);
		expect(result.metrics.singleChunkEvidenceQuestionCount).toBe(1);
		expect(result.metrics.multiChunkEvidenceQuestionCount).toBe(1);
		expect(result.rankings[1]).toMatchObject({
			allEvidenceRank: 2,
			firstEvidenceRank: 1,
			firstNoticeRank: 1,
		});
	});

	it("does not let identical evidence in another notice improve answer retrieval", () => {
		const distractor = chunk("a", 0, "2", "共享证据");
		const target = chunk("b", 0, "1", "共享证据");
		const result = evaluateDenseRetrieval({
			chunks: [distractor, target],
			documentVectorsByChunkId: new Map([
				[distractor.chunkId, [1, 0]],
				[target.chunkId, [1, 0]],
			]),
			questions: [
				{
					answer: "共享证据",
					evidence: [{ text: "共享证据" }],
					noticeId: "1",
					question: "目标通知的证据是什么？",
					questionId: "q-shared",
					stratum: "duplicate-evidence",
				},
			],
			queryVectorsByQuestionId: new Map([["q-shared", [1, 0]]]),
		});

		expect(result.rankings[0]).toMatchObject({
			answerEvidenceRank: 2,
			firstEvidenceRank: 2,
		});
	});

	it("caches vectors by target and text and reproduces the same evaluation run", async () => {
		const root = await mkdtemp(join(tmpdir(), "notice-embedding-evaluation-"));
		try {
			const chunkRun = await buildLocalNoticeChunkRun({
				artifactRoot: root,
				sources: [
					{ contentText: "第一条正文。", noticeId: "1", title: "第一条通知" },
					{ contentText: "第二条正文。", noticeId: "2", title: "第二条通知" },
				],
			});
			const chunks = (await readFile(join(chunkRun.outputDirectory, "chunks.ndjson"), "utf8"))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as NoticeChunk);
			const firstChunk = chunks.find((item) => item.noticeId === "1");
			if (!firstChunk) throw new Error("test chunk is missing");
			const questionFile = join(root, "questions.ndjson");
			await writeFile(
				questionFile,
				`${JSON.stringify({
					answer: "第一条正文。",
					evidence: [{ chunkId: firstChunk.chunkId, text: "第一条正文。" }],
					noticeId: "1",
					question: "第一条通知的正文是什么？",
					questionId: "q1",
					stratum: "single",
				})}\n`,
			);
			const embed = vi.fn(async (input: { dimensions: number; texts: string[] }) =>
				input.texts.map((text) => {
					const vector = Array(input.dimensions).fill(0) as number[];
					vector[text.includes("第一条") ? 0 : 1] = 1;
					return vector;
				}),
			);
			const first = await runLocalNoticeEmbeddingEvaluation({
				artifactRoot: root,
				chunkRun: chunkRun.run,
				embedding: { embed },
				modelTargetSha256: "a".repeat(64),
				questionFile,
			});
			const second = await runLocalNoticeEmbeddingEvaluation({
				artifactRoot: root,
				chunkRun: chunkRun.run,
				embedding: {
					async embed() {
						throw new Error("cached rerun called embedding provider");
					},
				},
				modelTargetSha256: "a".repeat(64),
				questionFile,
			});

			expect(first.generatedEmbeddingInputCount).toBe(3);
			expect(first.reusedEmbeddingInputCount).toBe(0);
			expect(second.generatedEmbeddingInputCount).toBe(0);
			expect(second.reusedEmbeddingInputCount).toBe(3);
			expect(second.run).toBe(first.run);
			expect(embed).toHaveBeenCalledTimes(1);
			expect(first.metrics.targetChunkRecallAt["1"]).toBe(1);
			expect(await readFile(join(first.outputDirectory, "manifest.json"), "utf8")).toBe(
				await readFile(join(second.outputDirectory, "manifest.json"), "utf8"),
			);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});

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
