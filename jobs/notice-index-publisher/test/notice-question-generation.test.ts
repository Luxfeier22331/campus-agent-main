import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildLocalNoticeChunkRun } from "../src/command.ts";
import { canonicalJsonBytes, encodeNdjson } from "../src/encoding.ts";
import {
	createOpenAICompatibleNoticeQuestionModel,
	materializeGeneratedNoticeQuestions,
	NOTICE_QUESTION_GENERATION_SYSTEM_PROMPT,
	NOTICE_QUESTION_MAX_OUTPUT_TOKENS,
	NOTICE_QUESTION_SET_DEFINITION,
	resolveNoticeQuestionModelConfig,
	runLocalNoticeQuestionSetGeneration,
	validateGeneratedQuestions,
} from "../src/notice-question-generation.ts";
import { parseLocalNoticeQuestionGenerationCommand } from "../src/local-notice-question-generation-cli.ts";
import { readNoticeChunkRun } from "../src/run-reader.ts";

describe("notice question model", () => {
	it("uses the explicit chunk context and structured output", async () => {
		const fetchImplementation: typeof fetch = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			expect(body.max_output_tokens).toBe(NOTICE_QUESTION_MAX_OUTPUT_TOKENS);
			expect(body.temperature).toBe(0);
			expect(JSON.parse(String((body.input as Array<{ content: string }>)[1]?.content))).toEqual({
				chunk_context: [{ chunk_ref: "chunk-0", content: "正文" }],
				notice_title: "通知标题",
			});
			return Response.json({
				output_text: JSON.stringify({
					questions: [
						{
							answer: "答案一",
							chunk_ref: "chunk-0",
							question: "通知标题问题一？",
						},
						{
							answer: "答案二",
							chunk_ref: "chunk-0",
							question: "通知标题问题二？",
						},
					],
				}),
			});
		});
		const model = createOpenAICompatibleNoticeQuestionModel(
			{ apiKey: "secret", baseUrl: "https://provider.example", model: "question-model" },
			fetchImplementation,
		);

		expect(await model.generate({ chunkContents: ["正文"], title: "通知标题" })).toHaveLength(2);
	});

	it("keeps the question contract focused on chunks", () => {
		expect(NOTICE_QUESTION_SET_DEFINITION).toMatchObject({
			algorithm: "notice_question_generation.v8",
			questionScope: "global-dense-single-chunk-fact",
		});
		expect(NOTICE_QUESTION_GENERATION_SYSTEM_PROMPT).toContain("Chunk 正文");
		expect(NOTICE_QUESTION_GENERATION_SYSTEM_PROMPT).toContain("本轮暂不处理名单类问题");
		expect(NOTICE_QUESTION_GENERATION_SYSTEM_PROMPT).toContain("每道问题必须选择一个且仅一个 Chunk");
	});

	it("rejects an unknown question chunk", async () => {
		const fetchImplementation: typeof fetch = vi.fn(async () =>
			Response.json({
				output_text: JSON.stringify({
					questions: [
						{
							answer: "答案一",
							chunk_ref: "chunk-2",
							question: "通知标题问题一？",
						},
						{
							answer: "答案二",
							chunk_ref: "chunk-0",
							question: "通知标题问题二？",
						},
					],
				}),
			}),
		);
		const model = createOpenAICompatibleNoticeQuestionModel(
			{ apiKey: "secret", baseUrl: "https://provider.example", model: "question-model" },
			fetchImplementation,
		);

		await expect(model.generate({ chunkContents: ["正文一", "正文二"], title: "通知标题" })).rejects.toThrow(
			"references unknown chunk: chunk-2",
		);
	});

	it("normalizes model configuration", () => {
		expect(
			resolveNoticeQuestionModelConfig({
				LLM_API_KEY: " secret ",
				LLM_BASE_URL: "https://provider.example///",
				LLM_MODEL: " question-model ",
			}),
		).toEqual({ apiKey: "secret", baseUrl: "https://provider.example", model: "question-model" });
	});
});

describe("notice question evidence", () => {
	it("materializes the selected chunk as evidence", () => {
		expect(
			materializeGeneratedNoticeQuestions({
				chunkContents: ["第一块正文", "第二块正文"],
				questions: [
					{
						answer: "第一块答案",
						chunkRef: "chunk-0",
						question: "通知主题的第一项是什么？",
					},
					{
						answer: "第二块答案",
						chunkRef: "chunk-1",
						question: "通知主题的第二项是什么？",
					},
				],
			}),
		).toEqual([
			{
				answer: "第一块答案",
				evidence: ["第一块正文"],
				question: "通知主题的第一项是什么？",
			},
			{
				answer: "第二块答案",
				evidence: ["第二块正文"],
				question: "通知主题的第二项是什么？",
			},
			]);
	});

	it("validates evidence against chunks without a source snapshot", () => {
		const questions = [
			{ answer: "答案一", evidence: ["正文一"], question: "通知一问题一？" },
			{ answer: "答案二", evidence: ["正文二"], question: "通知一问题二？" },
		];
		expect(
			validateGeneratedQuestions({
				chunks: [{ content: "正文一" }, { content: "正文二" }],
				noticeId: "1",
				questions,
			}),
		).toEqual(questions);
		expect(() =>
			validateGeneratedQuestions({
				chunks: [{ content: "正文一" }],
				noticeId: "1",
				questions,
			}),
		).toThrow("is not contained in a chunk");
	});
});

describe("local notice question set generation", () => {
	it("consumes the selected chunk run and writes stable question artifacts", async () => {
		const root = await mkdtemp(join(tmpdir(), "notice-question-generation-"));
		try {
			const sources = Array.from({ length: 168 }, (_, index) => ({
				contentText: `正文${index + 1}`,
				noticeId: String(index + 1),
				title: `通知${index + 1}`,
			}));
			const chunkRun = await buildLocalNoticeChunkRun({ artifactRoot: root, sources });
			const runData = await readNoticeChunkRun(root, chunkRun.run);
			const reviewDirectory = join(
				root,
				"notices/chunking/reviews/sha256",
				chunkRun.run.slice("sha256:".length),
				"broad-sample-v2",
			);
			await mkdir(reviewDirectory, { recursive: true });
			await Promise.all([
				writeFile(join(reviewDirectory, "census.json"), canonicalJsonBytes({ run: chunkRun.run })),
				writeFile(
					join(reviewDirectory, "broad-sample.ndjson"),
					encodeNdjson(
					sources.map((source) => ({
						chunks: runData.chunksByNoticeId.get(source.noticeId),
						noticeId: source.noticeId,
						primaryStratum: "coverage-fill",
						title: source.title,
					})),
					),
				),
				writeFile(
					join(reviewDirectory, "review-candidates.ndjson"),
					encodeNdjson(sources.slice(0, 10).map(({ noticeId }) => ({ noticeId }))),
				),
			]);

			const model = {
				generate: vi.fn(async ({ chunkContents, title }: { chunkContents: readonly string[]; title: string }) => [
					{
						answer: chunkContents[0] ?? "",
						chunkRef: "chunk-0",
						question: `${title}问题一？`,
					},
					{
						answer: chunkContents[0] ?? "",
						chunkRef: "chunk-0",
						question: `${title}问题二？`,
					},
				]),
			};
			const result = await runLocalNoticeQuestionSetGeneration({
				artifactRoot: root,
				chunkRun: chunkRun.run,
				model,
				modelName: "fake-question-model",
			});

			expect(result).toMatchObject({ questionCount: 336, targetedNoticeCount: 10, targetedQuestionCount: 20 });
			expect(model.generate).toHaveBeenCalledTimes(168);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});

describe("local notice question generation command", () => {
	it("parses only the chunk run argument", () => {
		const chunkRun = `sha256:${"a".repeat(64)}`;
		expect(parseLocalNoticeQuestionGenerationCommand(["--", "--chunk-run", chunkRun])).toEqual({ chunkRun });
		expect(() => parseLocalNoticeQuestionGenerationCommand(["--chunk-run", chunkRun, "--extra"])).toThrow(
			"Usage: generate-notice-questions-local",
		);
	});
});
