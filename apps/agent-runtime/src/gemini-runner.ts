import { randomUUID } from "node:crypto";
import {
	ApiError,
	type Content,
	FunctionCallingConfigMode,
	type GenerateContentParameters,
	type GenerateContentResponse,
	GoogleGenAI,
	type Part,
} from "@google/genai";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { z } from "zod";
import type {
	AgentRunner,
	AgentRunnerInput,
	AgentRunnerResult,
	StreamingAgentRunner,
	WebEvidence,
	WebSearchDiagnostic,
} from "./agent-run-contract.ts";
import { retrievalDeadlineAt } from "./execution-budget.ts";
import { createFunctionToolContext, invokeFunctionTool } from "./function-tools.ts";
import type { GeminiSourceResolver } from "./gemini-source-resolver.ts";
import { parseModelOutputJSON } from "./model-output.ts";
import { failedRunnerResult } from "./runner-failure.ts";
import { normalizedModelOutput, partialJSONStringField } from "./runner-output.ts";
import { AgentRuntimeError } from "./runtime-errors.ts";

type GeminiModels = Pick<GoogleGenAI["models"], "generateContent" | "generateContentStream">;
export interface GeminiRunnerOptions {
	resolveSources?: GeminiSourceResolver;
	createModels?: (input: AgentRunnerInput) => GeminiModels;
}

function modelsFor(input: AgentRunnerInput, options: GeminiRunnerOptions): GeminiModels {
	if (options.createModels) {
		return options.createModels(input);
	}
	return new GoogleGenAI({
		apiKey: input.providerConfig.apiKey,
		vertexai: false,
		httpOptions: {
			...(input.providerConfig.baseUrl ? { baseUrl: input.providerConfig.baseUrl } : {}),
			apiVersion: "",
			headers: { "user-agent": "campus-agent" },
			retryOptions: { attempts: 1 },
		},
	}).models;
}

function requestFor(input: AgentRunnerInput, contents: Content[]): GenerateContentParameters {
	return {
		model: input.providerConfig.model,
		contents,
		config: {
			systemInstruction: input.outputSchema
				? `${input.instructions}\nOutput a JSON object matching this application contract:\n${JSON.stringify(input.outputSchema.schema)}`
				: input.instructions,
			...(input.allowWebSearch
				? {
						toolConfig: {
							includeServerSideToolInvocations: true,
							functionCallingConfig: { mode: FunctionCallingConfigMode.VALIDATED },
						},
					}
				: {}),
			...(input.limits.maxOutputTokens ? { maxOutputTokens: input.limits.maxOutputTokens } : {}),
			...(input.signal ? { abortSignal: input.signal } : {}),
			tools: [
				...(input.tools.length > 0 && Date.now() < retrievalDeadlineAt(input.deadlineAt)
					? [
							{
								functionDeclarations: input.tools.map((tool) => ({
									name: tool.name,
									description: tool.description,
									parametersJsonSchema: tool.parameters ?? { type: "object", properties: {} },
								})),
							},
						]
					: []),
				...(input.allowWebSearch && Date.now() < retrievalDeadlineAt(input.deadlineAt)
					? [{ googleSearch: {} }]
					: []),
			],
		},
	};
}

function initialContents(input: AgentRunnerInput): Content[] {
	if (input.allowWebSearch && input.providerConfig.hostedWebSearch !== true) {
		throw new AgentRuntimeError("model_config_incompatible", "Hosted search is not available.");
	}
	return input.input.map((message) => ({
		role: message.role === "assistant" ? "model" : "user",
		parts: [{ text: message.content }],
	}));
}

function visibleText(response: GenerateContentResponse): string {
	return (response.candidates?.[0]?.content?.parts ?? [])
		.filter((part) => !part.thought)
		.map((part) => part.text ?? "")
		.join("");
}

function codePointOffset(text: string, byteOffset: number): number {
	return [...Buffer.from(text, "utf8").subarray(0, byteOffset).toString("utf8")].length;
}

type GeminiFunctionCall = NonNullable<NonNullable<Content["parts"]>[number]["functionCall"]>;
type GeminiGroundingMetadata = NonNullable<
	NonNullable<GenerateContentResponse["candidates"]>[number]["groundingMetadata"]
>;

async function executeGeminiFunctionCalls(
	input: AgentRunnerInput,
	context: ReturnType<typeof createFunctionToolContext>,
	calls: GeminiFunctionCall[],
): Promise<Part[]> {
	const parts: Part[] = [];
	for (const call of calls) {
		input.signal?.throwIfAborted();
		const tool = input.tools.find((tool) => tool.name === call.name);
		if (!(tool && call.args)) {
			throw new AgentRuntimeError(
				"tool_contract_mismatch",
				"Model called an unavailable or invalid function.",
			);
		}
		if (tool.parameters) {
			const parsed = z
				.fromJSONSchema(tool.parameters as Parameters<typeof z.fromJSONSchema>[0])
				.safeParse(call.args);
			if (!parsed.success) {
				throw new AgentRuntimeError(
					"tool_contract_mismatch",
					"Model function arguments do not match the tool schema.",
					{ operation: `tool.${tool.name}` },
				);
			}
		}
		const output = await invokeFunctionTool(tool, call.args, context, call.id ?? randomUUID());
		parts.push({
			functionResponse: {
				name: tool.name,
				...(call.id ? { id: call.id } : {}),
				response: output as unknown as Record<string, unknown>,
			},
		});
	}
	return parts;
}

interface GeminiStreamTurn {
	groundingSnapshots: GeminiGroundingMetadata[];
	response: GenerateContentResponse;
	content: Content;
	text: string;
	textDeltas: string[];
	functionCalls: GeminiFunctionCall[];
	finishReason?: string;
	contentSeen: boolean;
}

class StreamDeltaQueue {
	private readonly values: string[] = [];
	private readonly waiters: Array<(value: IteratorResult<string>) => void> = [];
	private closed = false;
	push(value: string) {
		const waiter = this.waiters.shift();
		if (waiter) {
			waiter({ value, done: false });
		} else {
			this.values.push(value);
		}
	}
	close() {
		this.closed = true;
		for (const waiter of this.waiters.splice(0)) {
			waiter({ value: undefined as never, done: true });
		}
	}
	async *[Symbol.asyncIterator](): AsyncIterator<string> {
		while (true) {
			const value = this.values.shift();
			if (value !== undefined) {
				yield value;
				continue;
			}
			if (this.closed) {
				return;
			}
			const next = await new Promise<IteratorResult<string>>((resolve) =>
				this.waiters.push(resolve),
			);
			if (next.done) {
				return;
			}
			yield next.value;
		}
	}
}

async function collectGeminiStreamTurn(
	input: AgentRunnerInput,
	models: GeminiModels,
	contents: Content[],
	result: AgentRunnerResult,
	onDelta?: (delta: string) => void,
): Promise<GeminiStreamTurn> {
	const parts: Part[] = [];
	let last: GenerateContentResponse | undefined;
	const groundingSnapshots: GeminiGroundingMetadata[] = [];
	let finishReason: string | undefined;
	let contentSeen = false;
	const textDeltas: string[] = [];
	const previousUsage = { ...result.usage };
	result.usage.modelRequestCount++;
	for await (const chunk of await models.generateContentStream(requestFor(input, contents))) {
		input.signal?.throwIfAborted();
		last = chunk;
		const candidate = chunk.candidates?.[0];
		if (candidate?.content) {
			contentSeen = true;
			parts.push(...(candidate.content.parts ?? []));
			const delta = visibleText(chunk);
			if (delta) {
				textDeltas.push(delta);
				onDelta?.(delta);
			}
		}
		if (candidate?.groundingMetadata) {
			groundingSnapshots.push(candidate.groundingMetadata);
		}
		finishReason = candidate?.finishReason ?? finishReason;
		if (chunk.usageMetadata) {
			result.usage.usageObserved = true;
			// Gemini reports cumulative usage on stream chunks. Keep the latest
			// valid snapshot instead of summing it once per chunk.
			if (chunk.usageMetadata.promptTokenCount !== undefined) {
				result.usage.inputTokens = previousUsage.inputTokens + chunk.usageMetadata.promptTokenCount;
			}
			result.usage.outputTokens =
				previousUsage.outputTokens +
				(chunk.usageMetadata.candidatesTokenCount ?? 0) +
				(chunk.usageMetadata.thoughtsTokenCount ?? 0);
			result.usage.cachedInputTokens =
				(previousUsage.cachedInputTokens ?? 0) + (chunk.usageMetadata.cachedContentTokenCount ?? 0);
		}
		result.providerResponseId = chunk.responseId ?? result.providerResponseId;
	}
	if (!last) {
		throw new AgentRuntimeError("run_failed", "Gemini stream returned no response.", {
			operation: "agent.model",
		});
	}
	const content: Content = { role: "model", parts };
	const response = {
		...last,
		candidates: [
			{
				...(last.candidates?.[0] ?? {}),
				content,
			},
		],
	} as GenerateContentResponse;
	return {
		groundingSnapshots,
		response,
		content,
		text: visibleText(response),
		textDeltas,
		functionCalls: parts.flatMap((part) => (part.functionCall ? [part.functionCall] : [])),
		...(finishReason ? { finishReason } : {}),
		contentSeen,
	};
}

function assertComplete(response: GenerateContentResponse): Content {
	const candidate = response.candidates?.[0];
	if (!candidate?.content || (candidate.finishReason && candidate.finishReason !== "STOP")) {
		throw new AgentRuntimeError("run_failed", "Model did not return a complete response.", {
			operation: "agent.model",
			detail: `Gemini finish reason: ${candidate?.finishReason ?? response.promptFeedback?.blockReason ?? "missing candidate"}`,
		});
	}
	return candidate.content;
}

function geminiErrorDetail(error: ApiError): string {
	// The SDK message wraps the provider error; retain only its explicit message.
	let message = error.message;
	try {
		const body = JSON.parse(message);
		message = typeof body?.error?.message === "string" ? body.error.message : "";
	} catch {
		// Some gateways return a plain error message.
	}
	return `Gemini returned HTTP ${error.status}${message ? `: ${message}` : ""}`;
}

function modelFailure(error: unknown, input: AgentRunnerInput): never {
	input.signal?.throwIfAborted();
	if (error instanceof AgentRuntimeError) {
		throw error;
	}
	if (error instanceof ApiError) {
		throw new AgentRuntimeError(
			error.status === 429
				? "provider_rate_limited"
				: error.status >= 500
					? "provider_http_failed"
					: "run_failed",
			"Model provider rejected the request.",
			{
				operation: "agent.model",
				httpStatus: error.status,
				detail: geminiErrorDetail(error),
			},
			{ cause: error },
		);
	}
	throw error;
}

function observeUsage(result: AgentRunnerResult, response: GenerateContentResponse) {
	result.usage.modelRequestCount++;
	const usage = response.usageMetadata;
	if (usage) {
		result.usage.usageObserved = true;
		result.usage.inputTokens += usage.promptTokenCount ?? 0;
		result.usage.outputTokens +=
			(usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
		result.usage.cachedInputTokens =
			(result.usage.cachedInputTokens ?? 0) + (usage.cachedContentTokenCount ?? 0);
	}
	result.providerResponseId = response.responseId ?? result.providerResponseId;
}

export function geminiGrounding(
	response: GenerateContentResponse,
	snapshots?: GeminiGroundingMetadata[],
): {
	used: boolean;
	evidence: WebEvidence[];
	diagnostic: WebSearchDiagnostic;
} {
	const candidate = response.candidates?.[0];
	const metadataList =
		snapshots ?? (candidate?.groundingMetadata ? [candidate.groundingMetadata] : []);
	const diagnostic: WebSearchDiagnostic = {
		schema_version: 1,
		state: "not_used",
		query_count: 0,
		chunk_count: 0,
		support_count: 0,
		converted_count: 0,
		discarded_count: 0,
		discard_reasons: {},
	};
	const evidence: WebEvidence[] = [];
	const queries = new Set<string>();
	const chunks = new Set<string>();
	const supports = new Set<string>();
	let hasSearchEntryPoint = false;
	const converted = new Set<string>();
	let sourceChunks = metadataList.find(
		(item) => (item.groundingChunks?.length ?? 0) > 0,
	)?.groundingChunks;
	const discard = (reason: "invalid_segment" | "invalid_source") => {
		diagnostic.discarded_count++;
		diagnostic.discard_reasons[reason] = (diagnostic.discard_reasons[reason] ?? 0) + 1;
	};
	for (const metadata of metadataList) {
		for (const query of metadata.webSearchQueries ?? []) {
			queries.add(query);
		}
		for (const chunk of metadata.groundingChunks ?? []) {
			chunks.add(JSON.stringify(chunk));
		}
		if (metadata.searchEntryPoint?.renderedContent) {
			hasSearchEntryPoint = true;
		}
		if (metadata.groundingChunks && metadata.groundingChunks.length > 0) {
			sourceChunks = metadata.groundingChunks;
		}
		for (const support of metadata.groundingSupports ?? []) {
			const sources = (support.groundingChunkIndices ?? []).map(
				(index) => sourceChunks?.[index]?.web,
			);
			const supportKey = JSON.stringify([support.segment, sources]);
			if (supports.has(supportKey)) {
				continue;
			}
			supports.add(supportKey);
			const segment = support.segment;
			const part = candidate?.content?.parts?.[segment?.partIndex ?? 0];
			if (!segment || part?.thought) {
				discard("invalid_segment");
				continue;
			}
			let excerpt = segment.text;
			if (!excerpt) {
				// Streaming text deltas form one logical text Part. Offsets refer to
				// that Part, not to the individual transport chunk carrying metadata.
				const text =
					snapshots && (segment.partIndex ?? 0) === 0 ? visibleText(response) : part?.text;
				const bytes = Buffer.from(text ?? "", "utf8");
				const start = segment.startIndex ?? 0;
				const end = segment.endIndex;
				try {
					if (
						!Number.isInteger(start) ||
						end === undefined ||
						!Number.isInteger(end) ||
						start < 0 ||
						end <= start ||
						end > bytes.length
					) {
						throw new Error("invalid offset");
					}
					excerpt = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, end));
				} catch {
					discard("invalid_segment");
					continue;
				}
			}
			for (const web of sources) {
				if (!(web?.uri && web.title)) {
					discard("invalid_source");
					continue;
				}
				let url: URL;
				try {
					url = new URL(web.uri);
					if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
						throw new Error("invalid source");
					}
				} catch {
					discard("invalid_source");
					continue;
				}
				const visible = visibleText(response);
				const startByte = segment.startIndex;
				const endByte = segment.endIndex;
				const hasByteOffsets = Number.isInteger(startByte) && Number.isInteger(endByte);
				const textIndex = visible.indexOf(excerpt);
				const excerptStart = hasByteOffsets
					? codePointOffset(visible, startByte as number)
					: textIndex >= 0
						? [...visible.slice(0, textIndex)].length
						: -1;
				const key = JSON.stringify([excerpt, url.toString(), excerptStart, endByte]);
				if (converted.has(key)) {
					continue;
				}
				converted.add(key);
				evidence.push({
					url: url.toString(),
					title: web.title,
					excerpt,
					...(excerptStart >= 0
						? {
								startIndex: excerptStart,
								endIndex: hasByteOffsets
									? codePointOffset(visible, endByte as number)
									: excerptStart + [...excerpt].length,
							}
						: {}),
				});
			}
		}
	}
	const used = queries.size > 0 || chunks.size > 0 || supports.size > 0 || hasSearchEntryPoint;
	diagnostic.query_count = queries.size;
	diagnostic.chunk_count = chunks.size;
	diagnostic.support_count = supports.size;
	diagnostic.converted_count = evidence.length;
	diagnostic.state =
		evidence.length > 0
			? "sources_available"
			: supports.size > 0
				? "unmapped"
				: used
					? "metadata_only"
					: "not_used";
	return {
		used,
		evidence,
		diagnostic,
	};
}

function emptyResult(): AgentRunnerResult & {
	webEvidence: WebEvidence[];
} {
	return {
		finalOutput: "",
		providerResponseId: "",
		toolResults: [],
		webEvidence: [],
		webSearchUsed: false,
		usage: {
			modelRequestCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			cachedInputTokens: 0,
			usageObserved: false,
		},
	};
}

function recordGrounding(result: AgentRunnerResult, grounding: ReturnType<typeof geminiGrounding>) {
	const previous = result.webSearchDiagnostic;
	const diagnostic = grounding.diagnostic;
	if (previous) {
		for (const field of [
			"query_count",
			"chunk_count",
			"support_count",
			"converted_count",
			"discarded_count",
		] as const) {
			diagnostic[field] += previous[field];
		}
		for (const reason of ["invalid_segment", "invalid_source", "answer_unmapped"] as const) {
			const count =
				(previous.discard_reasons[reason] ?? 0) + (diagnostic.discard_reasons[reason] ?? 0);
			if (count > 0) {
				diagnostic.discard_reasons[reason] = count;
			}
		}
		if (diagnostic.state === "not_used") {
			diagnostic.state = previous.state;
		}
		if (diagnostic.converted_count > 0) {
			diagnostic.state = "sources_available";
		}
	}
	result.webSearchDiagnostic = diagnostic;
	result.webSearchUsed ||= grounding.used;
	result.webEvidence = [...(result.webEvidence ?? []), ...grounding.evidence];
}

async function observed(
	input: AgentRunnerInput,
	call: () => Promise<GenerateContentResponse>,
): Promise<GenerateContentResponse> {
	return trace.getTracer("openinference.gemini").startActiveSpan(
		"gemini.generate",
		{
			attributes: {
				"openinference.span.kind": "LLM",
				"llm.provider": "google",
				"llm.model_name": input.providerConfig.model,
			},
		},
		async (span) => {
			try {
				const response = await call();
				const usage = response.usageMetadata;
				if (usage) {
					span.setAttributes({
						"llm.token_count.prompt": usage.promptTokenCount ?? 0,
						"llm.token_count.completion":
							(usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
						"llm.token_count.prompt_details.cache_read": usage.cachedContentTokenCount ?? 0,
					});
				}
				return response;
			} catch (error) {
				span.setStatus({ code: SpanStatusCode.ERROR });
				throw error;
			} finally {
				span.end();
			}
		},
	);
}

export function createGeminiRunner(options: GeminiRunnerOptions = {}): AgentRunner {
	return async (input) => {
		const models = modelsFor(input, options);
		const contents = initialContents(input);
		const context = createFunctionToolContext(input);
		const result = emptyResult();
		try {
			for (let turn = 0; turn < input.limits.maxTurns; turn++) {
				input.signal?.throwIfAborted();
				const response = await observed(input, () =>
					models.generateContent(requestFor(input, contents)),
				);
				input.signal?.throwIfAborted();
				observeUsage(result, response);
				const content = assertComplete(response);
				const grounding = geminiGrounding(response);
				recordGrounding(result, grounding);
				const calls = (content.parts ?? []).flatMap((part) =>
					part.functionCall ? [part.functionCall] : [],
				);
				if (calls.length === 0) {
					const text = visibleText(response);
					result.rawModelOutput = {
						text,
						finishReason: response.candidates?.[0]?.finishReason ?? null,
					};
					Object.assign(
						result,
						normalizedModelOutput(
							input.outputSchema ? parseModelOutputJSON(text, `workflow.${input.operation}`) : text,
							input.operation,
						),
					);
					result.toolResults = [...context.functionToolResults.values()];
					await options.resolveSources?.(input, result);
					input.signal?.throwIfAborted();
					return result;
				}
				contents.push(content);
				const parts = await executeGeminiFunctionCalls(input, context, calls);
				contents.push({ role: "user", parts });
			}
			throw new AgentRuntimeError("max_turns_exceeded", "Model turn budget exhausted.");
		} catch (error) {
			try {
				modelFailure(error, input);
			} catch (classified) {
				const failed = failedRunnerResult(classified, input, {
					...result,
					toolResults: [...context.functionToolResults.values()],
				});
				await options.resolveSources?.(input, failed);
				return failed;
			}
		}
	};
}

export function createStreamingGeminiRunner(
	options: GeminiRunnerOptions = {},
): StreamingAgentRunner {
	return async function* (input) {
		const models = modelsFor(input, options);
		const contents = initialContents(input);
		const context = createFunctionToolContext(input);
		const result = emptyResult();
		let outcome: "answer" | "plan" | undefined;
		const span = trace.getTracer("openinference.gemini").startSpan("gemini.generate.stream", {
			attributes: {
				"openinference.span.kind": "LLM",
				"llm.provider": "google",
				"llm.model_name": input.providerConfig.model,
			},
		});
		const finishSpan = () => {
			if (result.usage.usageObserved) {
				span.setAttributes({
					"llm.token_count.prompt": result.usage.inputTokens,
					"llm.token_count.completion": result.usage.outputTokens,
					"llm.token_count.prompt_details.cache_read": result.usage.cachedInputTokens ?? 0,
				});
			}
			span.end();
		};
		try {
			for (let turn = 0; turn < input.limits.maxTurns; turn++) {
				input.signal?.throwIfAborted();
				const deltaQueue = new StreamDeltaQueue();
				const streamPromise = collectGeminiStreamTurn(input, models, contents, result, (delta) =>
					deltaQueue.push(delta),
				).finally(() => deltaQueue.close());
				const streamedTextParts: string[] = [];
				let streamedText = "";
				let emitted = "";
				for await (const delta of deltaQueue) {
					streamedTextParts.push(delta);
					streamedText += delta;
					if (input.operation === "solve") {
						if (!outcome) {
							const match = /"outcome"\s*:\s*"(answer|plan)"/u.exec(streamedText);
							if (match) {
								outcome = match[1] as "answer" | "plan";
								yield { solveOutcome: outcome };
							}
						}
						if (outcome === "answer") {
							const answer = partialJSONStringField(streamedText, "answer");
							if (answer?.startsWith(emitted)) {
								const next = answer.slice(emitted.length);
								emitted = answer;
								if (next) {
									result.answerStarted = true;
									yield { delta: next };
								}
							}
						}
					} else {
						result.answerStarted = true;
						yield { delta };
					}
				}
				const streamed = await streamPromise;
				if (!streamed.contentSeen || streamed.finishReason !== "STOP") {
					throw new AgentRuntimeError(
						"run_failed",
						"Gemini stream ended without a complete response.",
						{
							operation: "agent.model",
							detail: `Gemini finish reason: ${streamed.finishReason ?? "missing"}`,
						},
					);
				}
				const grounding = geminiGrounding(streamed.response, streamed.groundingSnapshots);
				recordGrounding(result, grounding);
				if (streamed.functionCalls.length > 0) {
					contents.push(streamed.content);
					contents.push({
						role: "user",
						parts: await executeGeminiFunctionCalls(input, context, streamed.functionCalls),
					});
					continue;
				}
				result.rawModelOutput = { text: streamedText, finishReason: streamed.finishReason ?? null };
				Object.assign(
					result,
					normalizedModelOutput(
						input.outputSchema
							? parseModelOutputJSON(streamedText, `workflow.${input.operation}`)
							: streamedText,
						input.operation,
					),
				);
				result.toolResults = [...context.functionToolResults.values()];
				await options.resolveSources?.(input, result);
				input.signal?.throwIfAborted();
				finishSpan();
				yield result;
				return;
			}
			throw new AgentRuntimeError("max_turns_exceeded", "Model turn budget exhausted.");
		} catch (error) {
			span.setStatus({ code: SpanStatusCode.ERROR });
			try {
				modelFailure(error, input);
			} catch (classified) {
				const failed = failedRunnerResult(classified, input, {
					...result,
					toolResults: [...context.functionToolResults.values()],
				});
				await options.resolveSources?.(input, failed);
				yield failed;
			} finally {
				finishSpan();
			}
		}
	};
}

// Provider Content (including thought signatures) is kept verbatim between turns.
export async function runGeminiModelTurn(
	input: AgentRunnerInput,
	continuation?: import("./model-turn.ts").ProviderContinuation,
	onDelta?: (delta: string) => Promise<void>,
	options: GeminiRunnerOptions = {},
): Promise<import("./model-turn.ts").ModelTurn> {
	try {
		return await geminiModelTurn(input, continuation, onDelta, options);
	} catch (error) {
		modelFailure(error, input);
	}
}

async function geminiModelTurn(
	input: AgentRunnerInput,
	continuation?: import("./model-turn.ts").ProviderContinuation,
	onDelta?: (delta: string) => Promise<void>,
	options: GeminiRunnerOptions = {},
): Promise<import("./model-turn.ts").ModelTurn> {
	const models = modelsFor(input, options);
	const contents =
		continuation?.provider === "gemini" ? continuation.contents : initialContents(input);
	const result = emptyResult();
	// Keep provider transport independent from whether the caller publishes answer
	// deltas. The pre-Temporal Gemini path used streaming model requests; callers
	// without a UI delta consumer still receive the fully collected result below.
	let pending = Promise.resolve();
	const streamed = await collectGeminiStreamTurn(input, models, contents, result, (delta) => {
		if (onDelta) {
			pending = pending.then(() => onDelta(delta));
		}
	});
	await pending;
	if (!streamed.contentSeen || streamed.finishReason !== "STOP") {
		throw new AgentRuntimeError("run_failed", "Gemini stream ended without a complete response");
	}
	const response = streamed.response;
	const content = streamed.content;
	recordGrounding(result, geminiGrounding(streamed.response, streamed.groundingSnapshots));
	const calls = (content.parts ?? []).flatMap((part, index) =>
		part.functionCall
			? [
					{
						id: part.functionCall.id ?? `call.${index}`,
						name: part.functionCall.name ?? "",
						arguments: part.functionCall.args ?? {},
					},
				]
			: [],
	);
	if (calls.length === 0) {
		const text = (content.parts ?? [])
			.filter((p) => !p.thought)
			.map((p) => p.text ?? "")
			.join("");
		result.rawModelOutput = { text, finishReason: response.candidates?.[0]?.finishReason ?? null };
		try {
			Object.assign(
				result,
				normalizedModelOutput(
					input.outputSchema ? parseModelOutputJSON(text, `workflow.${input.operation}`) : text,
					input.operation,
				),
			);
		} catch {
			result.failure = { code: "model_output_invalid", operation: `workflow.${input.operation}` };
		}
		await options.resolveSources?.(input, result);
	}
	return { continuation: { provider: "gemini", contents: [...contents, content] }, calls, result };
}
