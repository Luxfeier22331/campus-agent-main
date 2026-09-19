import { once } from "node:events";
import { createServer } from "node:http";
import {
	ApiError,
	type Candidate,
	type Content,
	type GenerateContentParameters,
	type GenerateContentResponse,
} from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
	AgentRunnerAnswerDelta,
	AgentRunnerInput,
	AgentRunnerResult,
	AgentRunnerSolveDecision,
} from "../src/agent-run-contract.ts";
import {
	createGeminiRunner,
	createStreamingGeminiRunner,
	geminiGrounding,
} from "../src/gemini-runner.ts";
import { createConfiguredRunner } from "../src/provider-config.ts";
import { solveSdkOutputSchema } from "../src/workflow-runtime.ts";

function input(overrides: Partial<AgentRunnerInput> = {}): AgentRunnerInput {
	return {
		operation: "execute_step",
		input: [{ role: "user", content: "海淀校区地址？" }],
		instructions: "使用检索资料回答。",
		tools: [],
		requestId: "req-gemini",
		citationStart: 1,
		allowWebSearch: false,
		providerConfig: {
			provider: "google",
			transport: "generate_content",
			apiKey: "test-key",
			baseUrl: "http://127.0.0.1:1/v1beta",
			model: "gemini-3.1-flash-lite",
			hostedWebSearch: true,
		},
		limits: {
			agentDeadlineMs: 90000,
			contextCharLimit: 16000,
			currentInputCharLimit: 8000,
			maxOutputTokens: 2048,
			maxFunctionToolCalls: 3,
			maxTurns: 4,
		},
		...overrides,
	};
}

type TestResponse = GenerateContentResponse & { candidates: [Candidate & { content: Content }] };
function response(text: string): TestResponse {
	return {
		responseId: "gemini-response",
		candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
		usageMetadata: {
			promptTokenCount: 12,
			candidatesTokenCount: 6,
			thoughtsTokenCount: 2,
			cachedContentTokenCount: 3,
		},
	} as TestResponse;
}

function scripted(responses: GenerateContentResponse[]) {
	const requests: GenerateContentParameters[] = [];
	const generateContent = vi.fn(async (request: GenerateContentParameters) => {
		requests.push(structuredClone(request));
		const next = responses.shift();
		if (!next) {
			throw new Error("unexpected model turn");
		}
		return next;
	});
	return { requests, models: { generateContent, generateContentStream: vi.fn() } };
}

describe("Gemini native runner", () => {
	it("observes Gemini server tool parts without leaking them into answer text", async () => {
		const reportRetrieval = vi.fn();
		const generateContentStream = vi.fn(async function* (_request: GenerateContentParameters) {
			yield {
				candidates: [
					{
						content: {
							role: "model",
							parts: [
								{
									toolCall: {
										id: "search",
										toolType: "GOOGLE_SEARCH_WEB",
										args: { query: "private" },
									},
								},
							],
						},
					},
				],
			} as unknown as GenerateContentResponse;
			yield {
				candidates: [
					{
						content: {
							role: "model",
							parts: [
								{ toolResponse: { id: "search", toolType: "GOOGLE_SEARCH_WEB", response: {} } },
							],
						},
					},
				],
			} as unknown as GenerateContentResponse;
			yield response("资料答案");
		});
		const runner = createStreamingGeminiRunner({
			createModels: () => ({
				generateContent: vi.fn(),
				generateContentStream: async (request) => generateContentStream(request),
			}),
		});
		const events: (AgentRunnerAnswerDelta | AgentRunnerSolveDecision | AgentRunnerResult)[] = [];
		for await (const event of runner(
			input({ operation: "synthesize", allowWebSearch: true, reportRetrieval }),
		)) {
			events.push(event);
		}
		expect(
			generateContentStream.mock.calls[0]?.[0].config?.toolConfig?.includeServerSideToolInvocations,
		).toBe(true);
		expect(events.at(-1)).toMatchObject({ finalOutput: "资料答案" });
		expect(JSON.stringify(events)).not.toContain("private");
	});
	it.each([false, true])(
		"resolves collected grounding before returning a result (stream=%s)",
		async (stream) => {
			const grounded = response("海淀校区地址。");
			grounded.candidates[0].groundingMetadata = {
				groundingChunks: [
					{
						web: {
							uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test",
							title: "muc.edu.cn",
						},
					},
				],
				groundingSupports: [{ segment: { text: "海淀校区地址。" }, groundingChunkIndices: [0] }],
			};
			const resolveSources = vi.fn(async (_input: AgentRunnerInput, result: AgentRunnerResult) => {
				for (const item of result.webEvidence ?? []) {
					item.title = "民大概况";
					item.sourceLink = { href: "https://www.muc.edu.cn/ggfw/cjwt/mdgk.htm" };
				}
			});
			const options = {
				resolveSources,
				createModels: () => ({
					generateContent: async () => grounded,
					generateContentStream: async () =>
						(async function* () {
							yield grounded;
						})(),
				}),
			};
			let output: AgentRunnerResult | undefined;
			if (stream) {
				for await (const event of createStreamingGeminiRunner(options)(
					input({ allowWebSearch: true }),
				)) {
					if ("webEvidence" in event) {
						output = event;
					}
				}
			} else {
				output = await createGeminiRunner(options)(input({ allowWebSearch: true }));
			}
			expect(resolveSources).toHaveBeenCalledTimes(1);
			expect(output?.webEvidence?.[0]).toMatchObject({
				title: "民大概况",
				sourceLink: { href: "https://www.muc.edu.cn/ggfw/cjwt/mdgk.htm" },
			});
		},
	);

	it.each([false, true])(
		"preserves failed structured output and usage before any tools (stream=%s)",
		async (stream) => {
			const text = "```json\n{}\n```";
			const { models } = scripted([response(text)]);
			models.generateContentStream = vi.fn(async function* () {
				yield response(text);
			});
			const request = input({
				operation: "solve",
				outputSchema: { name: "solve_output", schema: {} },
			});
			let result: AgentRunnerResult;
			if (stream) {
				const events: (AgentRunnerAnswerDelta | AgentRunnerSolveDecision | AgentRunnerResult)[] =
					[];
				for await (const event of createStreamingGeminiRunner({ createModels: () => models })(
					request,
				)) {
					events.push(event);
				}
				result = events.at(-1) as AgentRunnerResult;
			} else {
				result = await createGeminiRunner({ createModels: () => models })(request);
			}
			expect(result).toMatchObject({
				failure: { code: "model_output_invalid" },
				providerResponseId: "gemini-response",
				usage: { modelRequestCount: 1, outputTokens: 8 },
				modelOutputDiagnostic: { text, finish_reason: "STOP", validation_stage: "json_parse" },
			});
		},
	);
	it.each([0, undefined, 8192])("projects the optional output limit %s", async (limit) => {
		for (const stream of [false, true]) {
			const { models, requests } = scripted([response("完成")]);
			models.generateContentStream = vi.fn(async function* (request: GenerateContentParameters) {
				requests.push(structuredClone(request));
				yield response("完成");
			});
			const request = input();
			if (limit === undefined) {
				delete request.limits.maxOutputTokens;
			} else {
				request.limits.maxOutputTokens = limit;
			}
			if (stream) {
				for await (const _event of createStreamingGeminiRunner({ createModels: () => models })(
					request,
				)) {
					// Consume the complete model turn.
				}
			} else {
				await createGeminiRunner({ createModels: () => models })(request);
			}
			expect(requests).toHaveLength(1);
			if (limit) {
				expect(requests[0]?.config?.maxOutputTokens).toBe(limit);
			} else {
				expect(requests[0]?.config).not.toHaveProperty("maxOutputTokens");
			}
		}
	});

	it.each([false, true])(
		"stops at the citation limit and retains multi-turn usage (stream=%s)",
		async (stream) => {
			const responses = Array.from({ length: 3 }, (_, index) => {
				const item = response("");
				item.responseId = `response-${index}`;
				item.candidates[0].content.parts = [
					{
						functionCall: {
							name: "campus_search",
							args: { search_query: `query-${index}` },
							id: `call-${index}`,
						},
					},
				];
				return item;
			});
			const { models } = scripted(responses);
			models.generateContentStream = vi.fn(async function* () {
				const item = responses.shift();
				if (!item) {
					throw new Error("unexpected turn");
				}
				yield item;
			});
			const execute = vi.fn(async (_args, context) => ({
				status: "completed" as const,
				result: {
					outcome: "matched",
					results: Array.from({ length: 5 }, (_, index) => ({
						citation_index: context.citationStart + index,
					})),
				},
			}));
			const request = input({ tools: [{ name: "campus_search", description: "RAG", execute }] });
			let result: AgentRunnerResult;
			if (stream) {
				const items: (AgentRunnerAnswerDelta | AgentRunnerSolveDecision | AgentRunnerResult)[] = [];
				for await (const item of createStreamingGeminiRunner({ createModels: () => models })(
					request,
				)) {
					items.push(item);
				}
				result = items.at(-1) as AgentRunnerResult;
			} else {
				result = await createGeminiRunner({ createModels: () => models })(request);
			}
			expect(execute).toHaveBeenCalledTimes(2);
			expect(result.failure?.code).toBe("retrieval_budget_exhausted");
			expect(result.toolResults).toHaveLength(3);
			expect(result.usage).toMatchObject({
				modelRequestCount: 3,
				inputTokens: 36,
				outputTokens: 24,
				cachedInputTokens: 9,
			});
			expect(result.providerResponseId).toBe("response-2");
		},
	);
	it("selects the native SDK and sends its HTTP request to the configured versioned endpoint", async () => {
		const requests: Array<{
			url: string | undefined;
			key: string | string[] | undefined;
			body: unknown;
		}> = [];
		const server = createServer(async (request, reply) => {
			let body = "";
			for await (const chunk of request) {
				body += chunk;
			}
			requests.push({
				url: request.url,
				key: request.headers["x-goog-api-key"],
				body: JSON.parse(body),
			});
			reply.setHeader("content-type", "application/json");
			reply.end(JSON.stringify(response("原生调用完成")));
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		try {
			const address = server.address();
			if (!address || typeof address === "string") {
				throw new Error("missing test port");
			}
			const request = input();
			request.providerConfig.baseUrl = `http://127.0.0.1:${address.port}/v1beta`;
			const result = await createConfiguredRunner()(request);
			expect(result.finalOutput).toBe("原生调用完成");
			expect(requests).toEqual([
				{
					url: "/v1beta/models/gemini-3.1-flash-lite:generateContent",
					key: "test-key",
					body: expect.objectContaining({
						contents: [{ role: "user", parts: [{ text: "海淀校区地址？" }] }],
					}),
				},
			]);
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});
	it("rejects invalid function arguments before executing the tool", async () => {
		const call = response("");
		call.candidates[0].content.parts = [
			{ functionCall: { name: "campus_search", args: { search_query: 42 } } },
		];
		const script = scripted([call]);
		const execute = vi.fn();
		await expect(
			createGeminiRunner({ createModels: () => script.models })(
				input({
					tools: [
						{
							name: "campus_search",
							description: "RAG",
							parameters: {
								type: "object",
								additionalProperties: false,
								properties: { search_query: { type: "string" } },
								required: ["search_query"],
							},
							execute,
						},
					],
				}),
			),
		).rejects.toMatchObject({ code: "tool_contract_mismatch" });
		expect(execute).not.toHaveBeenCalled();
	});
	it("sends neutral history and returns text with usage", async () => {
		const script = scripted([response("检索完成。")]);
		const result = await createGeminiRunner({ createModels: () => script.models })(
			input({
				input: [
					{ role: "assistant", content: "你好" },
					{ role: "user", content: "地址？" },
				],
			}),
		);
		expect(script.requests[0]).toMatchObject({
			contents: [
				{ role: "model", parts: [{ text: "你好" }] },
				{ role: "user", parts: [{ text: "地址？" }] },
			],
			config: { systemInstruction: "使用检索资料回答。", maxOutputTokens: 2048 },
		});
		expect(result).toMatchObject({
			finalOutput: "检索完成。",
			providerResponseId: "gemini-response",
			usage: {
				modelRequestCount: 1,
				inputTokens: 12,
				outputTokens: 8,
				cachedInputTokens: 3,
				usageObserved: true,
			},
		});
	});
	it("uses native structured output and unwraps Solve", async () => {
		const script = scripted([
			response(JSON.stringify({ result: { answer: "你好", outcome: "answer" } })),
		]);
		const result = await createGeminiRunner({ createModels: () => script.models })(
			input({
				operation: "solve",
				outputSchema: { name: "solve", schema: z.toJSONSchema(solveSdkOutputSchema) },
			}),
		);
		expect(result).toMatchObject({
			finalOutput: "你好",
			structuredOutput: { answer: "你好", outcome: "answer" },
		});
		expect(script.requests[0]?.config).toMatchObject({ responseMimeType: "application/json" });
		expect(JSON.stringify(script.requests[0]?.config?.responseJsonSchema)).not.toContain('"const"');
		expect(JSON.stringify(script.requests[0]?.config?.responseJsonSchema)).not.toContain(
			'"maxLength"',
		);
		expect(JSON.stringify(script.requests[0]?.config?.responseJsonSchema)).not.toContain(
			'"maxItems"',
		);
	});
	it("round-trips RAG results and preserves the full signed model content", async () => {
		const callResponse = response("");
		callResponse.candidates[0].content = {
			role: "model",
			parts: [
				{
					functionCall: {
						id: "call-rag",
						name: "campus_search",
						args: { search_query: "海淀校区" },
					},
					thoughtSignature: "opaque-signature",
				},
			],
		};
		const script = scripted([callResponse, response("海淀校区位于中关村南大街27号。[1]")]);
		const execute = vi.fn(async () => ({
			status: "completed" as const,
			result: {
				outcome: "matched",
				results: [{ citation_index: 1, text: "海淀校区：中关村南大街27号" }],
			},
		}));
		const result = await createGeminiRunner({ createModels: () => script.models })(
			input({
				allowWebSearch: true,
				tools: [{ name: "campus_search", description: "校内检索", execute }],
			}),
		);
		expect(script.requests[0]?.config?.tools).toEqual([
			expect.objectContaining({ functionDeclarations: expect.any(Array) }),
			{ googleSearch: {} },
		]);
		expect(script.requests[1]?.contents).toEqual([
			expect.any(Object),
			callResponse.candidates?.[0]?.content,
			{
				role: "user",
				parts: [
					{
						functionResponse: {
							name: "campus_search",
							id: "call-rag",
							response: {
								status: "completed",
								result: {
									outcome: "matched",
									results: [{ citation_index: 1, text: "海淀校区：中关村南大街27号" }],
								},
							},
						},
					},
				],
			},
		]);
		expect(execute).toHaveBeenCalledWith(
			{ search_query: "海淀校区" },
			expect.objectContaining({
				citationStart: 1,
				invocationId: "call-rag",
				resultLimit: 5,
				deadlineAt: expect.any(String),
			}),
		);
		expect(result.toolResults[0]).toMatchObject({
			invocationId: "call-rag",
			status: "completed",
			toolName: "campus_search",
		});
		expect(result.usage.modelRequestCount).toBe(2);
	});
	it("extracts UTF-8 grounding excerpts while discarding search suggestions", () => {
		const grounded = response("😀海淀校区地址。");
		grounded.candidates[0].groundingMetadata = {
			webSearchQueries: ["中央民族大学 地址"],
			groundingChunks: [{ web: { uri: "https://www.muc.edu.cn/", title: "学校官网" } }],
			groundingSupports: [{ segment: { startIndex: 4, endIndex: 16 }, groundingChunkIndices: [0] }],
			searchEntryPoint: {
				renderedContent:
					'<div><a href="https://www.google.com/search?q=muc" target="_blank">搜索建议</a></div>',
			},
		};
		expect(geminiGrounding(grounded)).not.toHaveProperty("suggestions");
		expect(geminiGrounding(grounded)).toMatchObject({
			used: true,
			evidence: [{ excerpt: "海淀校区", url: "https://www.muc.edu.cn/", title: "学校官网" }],
		});
	});
	it("stops at the turn budget", async () => {
		const call = response("");
		call.candidates[0].content.parts = [{ functionCall: { name: "lookup", args: {} } }];
		const script = scripted([call]);
		await expect(
			createGeminiRunner({ createModels: () => script.models })(
				input({
					limits: { ...input().limits, maxTurns: 1 },
					tools: [
						{
							name: "lookup",
							description: "lookup",
							execute: async () => ({ status: "completed", result: {} }),
						},
					],
				}),
			),
		).resolves.toMatchObject({ failure: { code: "max_turns_exceeded" } });
		expect(script.models.generateContent).toHaveBeenCalledTimes(1);
	});
	it("propagates cancellation without another request", async () => {
		const controller = new AbortController();
		controller.abort(new Error("client canceled"));
		const script = scripted([]);
		await expect(
			createGeminiRunner({ createModels: () => script.models })(
				input({ signal: controller.signal }),
			),
		).rejects.toThrow("client canceled");
		expect(script.models.generateContent).not.toHaveBeenCalled();
	});
	it.each([
		[429, "provider_rate_limited"],
		[503, "provider_http_failed"],
		[400, "run_failed"],
		[401, "run_failed"],
	] as const)("classifies native HTTP %s as %s", async (status, code) => {
		const generateContent = vi
			.fn()
			.mockRejectedValue(new ApiError({ status, message: "provider rejected request" }));
		await expect(
			createGeminiRunner({
				createModels: () => ({ generateContent, generateContentStream: vi.fn() }),
			})(input()),
		).rejects.toMatchObject({ code });
	});
	it("streams only answer text from Solve JSON", async () => {
		const generateContentStream = vi.fn(async function* () {
			for (const text of ['{"result":{"outcome":"answer","answer":"你', '好"}}']) {
				yield response(text);
			}
		});
		const events: Array<AgentRunnerResult | AgentRunnerAnswerDelta | AgentRunnerSolveDecision> = [];
		for await (const event of createStreamingGeminiRunner({
			createModels: () => ({
				generateContent: vi.fn(),
				generateContentStream: async () => generateContentStream(),
			}),
		})(
			input({
				operation: "solve",
				outputSchema: { name: "solve", schema: z.toJSONSchema(solveSdkOutputSchema) },
			}),
		)) {
			events.push(event);
		}
		expect(events.slice(0, -1)).toEqual([
			{ solveOutcome: "answer" },
			{ delta: "你" },
			{ delta: "好" },
		]);
		expect(events.at(-1)).not.toHaveProperty("searchSuggestions");
		expect(events.at(-1) as AgentRunnerResult).toMatchObject({
			finalOutput: "你好",
			structuredOutput: { outcome: "answer", answer: "你好" },
		});
	});
	it("delivers answer text before upstream EOF, and completes only after EOF", async () => {
		let release!: () => void;
		const upstreamRelease = new Promise<void>((resolve) => {
			release = resolve;
		});
		let eof = false;
		const generateContentStream = async () =>
			(async function* () {
				yield response('{"result":{"outcome":"answer","answer":"第一段');
				await upstreamRelease;
				yield response('，第二段"}}');
				eof = true;
			})();
		const stream = createStreamingGeminiRunner({
			createModels: () => ({ generateContent: vi.fn(), generateContentStream }),
		})(
			input({
				operation: "solve",
				outputSchema: { name: "solve", schema: z.toJSONSchema(solveSdkOutputSchema) },
			}),
		)[Symbol.asyncIterator]();
		try {
			expect((await stream.next()).value).toEqual({ solveOutcome: "answer" });
			expect((await stream.next()).value).toEqual({ delta: "第一段" });
			expect(eof).toBe(false);
		} finally {
			release();
		}
		expect((await stream.next()).value).toEqual({ delta: "，第二段" });
		expect((await stream.next()).value).toMatchObject({ finalOutput: "第一段，第二段" });
		expect(eof).toBe(true);
		expect((await stream.next()).done).toBe(true);
	});
	it("continues a streaming Gemini function call before emitting the final answer", async () => {
		const call = response("");
		call.candidates[0].content.parts = [
			{
				functionCall: {
					id: "call-stream-rag",
					name: "campus_search",
					args: { search_query: "海淀校区" },
				},
			},
		];
		const final = response("海淀校区位于中关村南大街27号。");
		const requests: GenerateContentParameters[] = [];
		const chunks = [call, final];
		const generateContentStream = vi.fn(async (request: GenerateContentParameters) => {
			requests.push(structuredClone(request));
			return (async function* () {
				const next = chunks.shift();
				if (next) {
					yield next;
				}
			})();
		});
		const execute = vi.fn(async () => ({
			status: "completed" as const,
			result: {
				outcome: "matched",
				results: [{ citation_index: 1, text: "海淀校区：中关村南大街27号" }],
			},
		}));
		const events: Array<AgentRunnerResult | AgentRunnerAnswerDelta | AgentRunnerSolveDecision> = [];
		for await (const event of createStreamingGeminiRunner({
			createModels: () => ({ generateContent: vi.fn(), generateContentStream }),
		})(
			input({
				tools: [{ name: "campus_search", description: "RAG", execute }],
			}),
		)) {
			events.push(event);
		}
		expect(execute).toHaveBeenCalledOnce();
		expect(requests[1]?.contents).toEqual([
			expect.any(Object),
			call.candidates[0].content,
			{
				role: "user",
				parts: [
					{
						functionResponse: {
							name: "campus_search",
							id: "call-stream-rag",
							response: {
								status: "completed",
								result: {
									outcome: "matched",
									results: [{ citation_index: 1, text: "海淀校区：中关村南大街27号" }],
								},
							},
						},
					},
				],
			},
		]);
		expect(events).toEqual([
			{ delta: "海淀校区位于中关村南大街27号。" },
			expect.objectContaining({
				finalOutput: "海淀校区位于中关村南大街27号。",
				toolResults: [expect.objectContaining({ invocationId: "call-stream-rag" })],
			}),
		]);
	});
	it("converts grounding metadata from the final streaming turn", async () => {
		const grounded = response("海淀校区位于中关村南大街27号。");
		grounded.candidates[0].groundingMetadata = {
			webSearchQueries: ["中央民族大学 海淀校区 地址"],
			groundingChunks: [{ web: { uri: "https://www.muc.edu.cn/", title: "学校官网" } }],
			groundingSupports: [{ segment: { startIndex: 0, endIndex: 15 }, groundingChunkIndices: [0] }],
			searchEntryPoint: { renderedContent: "<div>搜索建议</div>" },
		};
		const generateContentStream = vi.fn(async () =>
			(async function* () {
				yield grounded;
			})(),
		);
		const events: Array<AgentRunnerResult | AgentRunnerAnswerDelta | AgentRunnerSolveDecision> = [];
		for await (const event of createStreamingGeminiRunner({
			createModels: () => ({ generateContent: vi.fn(), generateContentStream }),
		})(input({ allowWebSearch: true }))) {
			events.push(event);
		}
		expect(events.at(-1)).not.toHaveProperty("searchSuggestions");
		expect(events.at(-1) as AgentRunnerResult).toMatchObject({
			webSearchUsed: true,
			webEvidence: [{ url: "https://www.muc.edu.cn/", title: "学校官网" }],
		});
	});
	it("preserves earlier stream grounding through a suggestions-only tail", async () => {
		const text = "😀海淀校区地址。";
		const first = response("😀海淀");
		const second = response("校区地址。");
		second.candidates[0].groundingMetadata = {
			groundingChunks: [{ web: { uri: "https://www.muc.edu.cn/", title: "学校官网" } }],
			groundingSupports: [
				{
					segment: { startIndex: 4, endIndex: Buffer.byteLength(text) },
					groundingChunkIndices: [0],
				},
			],
		};
		const tail = response("");
		tail.candidates[0].groundingMetadata = {
			searchEntryPoint: { renderedContent: "<div>搜索建议</div>" },
		};
		const events: Array<AgentRunnerResult | AgentRunnerAnswerDelta | AgentRunnerSolveDecision> = [];
		for await (const event of createStreamingGeminiRunner({
			createModels: () => ({
				generateContent: vi.fn(),
				generateContentStream: async () =>
					(async function* () {
						yield first;
						yield second;
						yield tail;
					})(),
			}),
		})(input({ allowWebSearch: true }))) {
			events.push(event);
		}
		expect(events.at(-1)).not.toHaveProperty("searchSuggestions");
		expect(events.at(-1)).toMatchObject({
			finalOutput: text,
			webEvidence: [{ excerpt: "海淀校区地址。", startIndex: 1, endIndex: 8 }],
			webSearchDiagnostic: { state: "sources_available", support_count: 1, converted_count: 1 },
		});
	});

	it("uses segment text before offsets and records discarded supports without failing the answer", () => {
		const grounded = response("海淀校区地址。");
		grounded.candidates[0].groundingMetadata = {
			groundingChunks: [{ web: { uri: "https://www.muc.edu.cn/", title: "学校官网" } }],
			groundingSupports: [
				{ segment: { text: "海淀校区", endIndex: 999 }, groundingChunkIndices: [0] },
				{ segment: { endIndex: 999 }, groundingChunkIndices: [0] },
				{ segment: { text: "地址" }, groundingChunkIndices: [9] },
			],
		};
		expect(geminiGrounding(grounded)).toMatchObject({
			evidence: [{ excerpt: "海淀校区" }],
			diagnostic: {
				converted_count: 1,
				discarded_count: 2,
				discard_reasons: { invalid_segment: 1, invalid_source: 1 },
			},
		});
	});

	it.each([{}, { endIndex: 999 }])(
		"maps text-only grounding after emoji to codepoints: %j",
		(offsets) => {
			const grounded = response("😀海淀校区地址。");
			grounded.candidates[0].groundingMetadata = {
				groundingChunks: [{ web: { uri: "https://www.muc.edu.cn/", title: "学校官网" } }],
				groundingSupports: [
					{ segment: { text: "海淀校区地址。", ...offsets }, groundingChunkIndices: [0] },
				],
			};
			expect(geminiGrounding(grounded).evidence).toEqual([
				{
					excerpt: "海淀校区地址。",
					startIndex: 1,
					endIndex: 8,
					title: "学校官网",
					url: "https://www.muc.edu.cn/",
				},
			]);
		},
	);

	it("distinguishes metadata-only search from an unused search tool", () => {
		const grounded = response("答案");
		expect(geminiGrounding(grounded).diagnostic.state).toBe("not_used");
		grounded.candidates[0].groundingMetadata = {
			searchEntryPoint: { renderedContent: "<div>建议</div>" },
		};
		expect(geminiGrounding(grounded)).not.toHaveProperty("suggestions");
		expect(geminiGrounding(grounded)).toMatchObject({
			used: true,
			evidence: [],
			diagnostic: { state: "metadata_only" },
		});
	});

	it("rejects a truncated stream instead of reporting completion", async () => {
		const generateContentStream = vi.fn(async function* () {
			const chunk = response("部分回答");
			delete chunk.candidates?.[0]?.finishReason;
			yield chunk;
		});
		const events: (AgentRunnerAnswerDelta | AgentRunnerSolveDecision | AgentRunnerResult)[] = [];
		for await (const event of createStreamingGeminiRunner({
			createModels: () => ({
				generateContent: vi.fn(),
				generateContentStream: async () => generateContentStream(),
			}),
		})(input({ operation: "synthesize" }))) {
			events.push(event);
		}
		expect(events.at(-1)).toMatchObject({
			failure: { code: "run_failed" },
			answerStarted: true,
			finalOutput: "",
		});
	});
});
