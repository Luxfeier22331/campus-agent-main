import {
	Agent,
	type AgentOptions,
	type AgentOutputType,
	AgentsError,
	type ModelProvider,
	NoopTrace,
	Runner,
	RunResult,
	type StreamedRunResult,
	tool,
	Usage,
	webSearchTool,
	withTrace,
} from "@openai/agents";
import {
	CITATION_REASONS,
	type CitationDiagnostic,
	type CitationReason,
} from "campus-contracts/citation-diagnostic";
import type {
	AgentRunner,
	AgentRunnerAnswerDelta,
	AgentRunnerInput,
	AgentRunnerResult,
	AgentRunnerSolveDecision,
	PromptProviderRuntimeConfig,
	StreamingAgentRunner,
	ToolExecutionResult,
	WebEvidence,
} from "./agent-run-contract.ts";
import {
	type FunctionToolContext as AgentSdkContext,
	createFunctionToolContext,
	invokeFunctionTool,
} from "./function-tools.ts";
import { parseModelOutputJSON } from "./model-output.ts";
import { openAIRuntimeError } from "./openai-errors.ts";
import { failedRunnerResult } from "./runner-failure.ts";
import { normalizedModelOutput, partialJSONStringField } from "./runner-output.ts";
import { AgentRuntimeError } from "./runtime-errors.ts";
import type { JsonObjectSchema } from "./tool-catalog.ts";

const emptyParametersSchema = {
	type: "object" as const,
	additionalProperties: false as const,
	properties: {},
	required: [],
};

type CampusAgent = Agent<AgentSdkContext, AgentOutputType>;

export interface OpenAIAgentsRunnerOptions {
	model?: string;
	modelProvider?: ModelProvider;
	resolveRuntimeOptions?: (
		providerConfig: PromptProviderRuntimeConfig,
	) => Pick<OpenAIAgentsRunnerOptions, "model" | "modelProvider">;
}

export function createOpenAIAgentsRunner(options: OpenAIAgentsRunnerOptions = {}): AgentRunner {
	return async (input) => {
		let runtime: ReturnType<typeof createSdkRuntime> | undefined;
		let result:
			| RunResult<AgentSdkContext, CampusAgent>
			| StreamedRunResult<AgentSdkContext, CampusAgent>
			| undefined;
		try {
			const requestOptions = resolveRequestOptions(options, input.providerConfig);
			runtime = createSdkRuntime(input, requestOptions.model?.trim() || undefined);
			const runner = createSdkRunner(requestOptions.modelProvider, input.operation);
			const items = input.input.map((message) =>
				message.role === "assistant"
					? {
							role: "assistant" as const,
							status: "completed" as const,
							content: [{ type: "output_text" as const, text: message.content }],
						}
					: { role: "user" as const, content: message.content },
			);
			const runOptions = {
				context: runtime.context,
				maxTurns: input.limits.maxTurns,
				...(input.signal ? { signal: input.signal } : {}),
			};
			if (input.providerConfig.transport === "responses") {
				const streamed = await runner.run(runtime.agent, items, { ...runOptions, stream: true });
				result = streamed;
				for await (const _event of streamed) {
					// Receive provider events without publishing answer deltas for buffered callers.
				}
				await streamed.completed;
				throwIfStreamRunDidNotComplete(streamed, input.signal);
			} else {
				result = await runner.run(runtime.agent, items, runOptions);
			}
			return agentRunnerResultFromSDKResult(result, input);
		} catch (error) {
			const classified = openAIRuntimeError(error);
			if (runtime) {
				return failedRunnerResult(
					classified,
					input,
					partialSdkResult(runtime.context, result ?? sdkErrorResult(error)),
				);
			}
			throw classified;
		}
	};
}

export function createStreamingOpenAIAgentsRunner(
	options: OpenAIAgentsRunnerOptions = {},
): StreamingAgentRunner {
	return async function* (input) {
		let runtime: ReturnType<typeof createSdkRuntime> | undefined;
		let result: StreamedRunResult<AgentSdkContext, CampusAgent> | undefined;
		let answerStarted = false;
		try {
			const requestOptions = resolveRequestOptions(options, input.providerConfig);
			runtime = createSdkRuntime(input, requestOptions.model?.trim() || undefined);
			const runner = createSdkRunner(requestOptions.modelProvider, input.operation);
			result = await runner.run(
				runtime.agent,
				input.input.map((message) =>
					message.role === "assistant"
						? {
								role: "assistant" as const,
								status: "completed" as const,
								content: [{ type: "output_text" as const, text: message.content }],
							}
						: { role: "user" as const, content: message.content },
				),
				{
					context: runtime.context,
					maxTurns: input.limits.maxTurns,
					...(input.signal ? { signal: input.signal } : {}),
					stream: true,
				},
			);
			if (input.operation === "solve") {
				for await (const event of streamSolveResult(result, input)) {
					if ("delta" in event && event.delta !== "") {
						answerStarted = true;
					}
					yield event;
				}
				return;
			}
			for await (const event of result) {
				if (
					event.type !== "raw_model_stream_event" ||
					event.data.type !== "output_text_delta" ||
					input.operation === "execute_step"
				) {
					continue;
				}
				const delta = event.data.delta;
				if (delta !== "") {
					answerStarted = true;
					yield { delta } satisfies AgentRunnerAnswerDelta;
				}
			}
			await result.completed;
			throwIfStreamRunDidNotComplete(result, input.signal);
			yield agentRunnerResultFromSDKResult(result, input);
		} catch (error) {
			const classified = openAIRuntimeError(error);
			if (runtime) {
				yield failedRunnerResult(classified, input, {
					...partialSdkResult(runtime.context, result ?? sdkErrorResult(error)),
					answerStarted,
				});
				return;
			}
			throw classified;
		}
	};
}

function sdkErrorResult(error: unknown): RunResult<AgentSdkContext, CampusAgent> | undefined {
	return error instanceof AgentsError && error.state ? new RunResult(error.state) : undefined;
}

function partialSdkResult(
	context: AgentSdkContext,
	result?:
		| RunResult<AgentSdkContext, CampusAgent>
		| StreamedRunResult<AgentSdkContext, CampusAgent>,
): AgentRunnerResult {
	return {
		finalOutput: "",
		providerResponseId: result?.lastResponseId?.trim() ?? "",
		toolResults: [...context.functionToolResults.values()],
		...(result
			? {
					webEvidence: extractWebEvidence(result),
					webSearchUsed: webSearchUsedFromSDKResult(result),
				}
			: {}),
		usage: result
			? usageFromSDK(result.runContext.usage)
			: {
					modelRequestCount: 0,
					inputTokens: 0,
					outputTokens: 0,
					cachedInputTokens: 0,
					usageObserved: false,
				},
	};
}

async function* streamSolveResult(
	result: StreamedRunResult<AgentSdkContext, CampusAgent>,
	input: AgentRunnerInput,
): AsyncGenerator<AgentRunnerAnswerDelta | AgentRunnerSolveDecision | AgentRunnerResult> {
	let serializedOutput = "";
	let outcome: "answer" | "plan" | undefined;
	let emittedAnswer = "";
	for await (const event of result) {
		if (event.type !== "raw_model_stream_event" || event.data.type !== "output_text_delta") {
			continue;
		}
		serializedOutput += event.data.delta;
		if (!outcome) {
			const outcomeMatch = /"outcome"\s*:\s*"(answer|plan)"/u.exec(serializedOutput);
			if (outcomeMatch?.[1] === "answer" || outcomeMatch?.[1] === "plan") {
				outcome = outcomeMatch[1];
				yield { solveOutcome: outcome };
			}
		}
		if (outcome === "answer") {
			const answer = partialJSONStringField(serializedOutput, "answer");
			if (answer?.startsWith(emittedAnswer)) {
				const delta = answer.slice(emittedAnswer.length);
				emittedAnswer = answer;
				if (delta !== "") {
					yield { delta };
				}
			}
		}
	}
	await result.completed;
	throwIfStreamRunDidNotComplete(result, input.signal);
	const finalResult = agentRunnerResultFromSDKResult(result, input);
	if (!outcome) {
		const structured = finalResult.structuredOutput;
		if (
			isRecord(structured) &&
			(structured.outcome === "answer" || structured.outcome === "plan")
		) {
			outcome = structured.outcome;
			yield { solveOutcome: outcome };
			if (outcome === "answer" && emittedAnswer === "") {
				emittedAnswer = finalResult.finalOutput;
				if (emittedAnswer !== "") {
					yield { delta: emittedAnswer };
				}
			}
		}
	}
	yield finalResult;
}

function resolveRequestOptions(
	options: OpenAIAgentsRunnerOptions,
	providerConfig: PromptProviderRuntimeConfig,
) {
	return (
		options.resolveRuntimeOptions?.(providerConfig) ?? {
			...(options.model ? { model: options.model } : {}),
			...(options.modelProvider ? { modelProvider: options.modelProvider } : {}),
		}
	);
}

function createSdkRunner(
	modelProvider: ModelProvider | undefined,
	operation: AgentRunnerInput["operation"],
): Runner {
	return new Runner({
		...(modelProvider ? { modelProvider } : {}),
		workflowName: `campus-agent.workflow.${operation}`,
		traceIncludeSensitiveData: false,
	});
}

function throwIfStreamRunDidNotComplete(
	result: StreamedRunResult<AgentSdkContext, CampusAgent>,
	signal: AbortSignal | undefined,
): void {
	if (result.error !== undefined && result.error !== null) {
		throw result.error;
	}
	if (result.cancelled === false) {
		return;
	}
	if (result.cancelled !== true && signal?.aborted !== true) {
		return;
	}
	throw signal?.reason ?? new Error("Agent SDK stream was cancelled before completion.");
}

function createSdkRuntime(input: AgentRunnerInput, model: string | undefined) {
	const context = createFunctionToolContext(input);
	if (input.allowWebSearch && input.providerConfig.hostedWebSearch !== true) {
		throw new AgentRuntimeError(
			"model_config_incompatible",
			"The selected model target does not support hosted Web Search.",
			{ operation: `workflow.${input.operation}` },
		);
	}
	const hostedTools =
		input.allowWebSearch && input.providerConfig.hostedWebSearch === true ? [webSearchTool()] : [];
	const agentConfig: AgentOptions<AgentSdkContext, AgentOutputType> = {
		name: `Campus workflow ${input.operation}`,
		instructions: modelInstructions(input),
		...(model ? { model } : {}),
		modelSettings: modelSettings(input),
		tools: [...input.tools.map((runtimeTool) => sdkTool(runtimeTool)), ...hostedTools],
	} as AgentOptions<AgentSdkContext, AgentOutputType>;
	const agent = new Agent<AgentSdkContext, AgentOutputType>(agentConfig);
	return { agent, context };
}

function modelInstructions(input: AgentRunnerInput): string {
	return input.outputSchema
		? `${input.instructions}\nOutput a JSON object matching this application contract:\n${JSON.stringify(input.outputSchema.schema)}`
		: input.instructions;
}

function modelSettings(input: AgentRunnerInput) {
	return {
		...(input.limits.maxOutputTokens ? { maxTokens: input.limits.maxOutputTokens } : {}),
		...(input.outputSchema
			? {
					providerData:
						input.providerConfig.transport === "responses"
							? { text: { format: { type: "json_object" } } }
							: { response_format: { type: "json_object" } },
				}
			: {}),
	};
}

function sdkTool(runtimeTool: AgentRunnerInput["tools"][number]) {
	return tool<JsonObjectSchema, AgentSdkContext>({
		name: runtimeTool.name,
		description: runtimeTool.description,
		parameters: runtimeTool.parameters ?? emptyParametersSchema,
		strict: true,
		errorFunction: null,
		async execute(argumentsJson, runContext, details) {
			const context = runContext?.context;
			if (!context) {
				throw new AgentRuntimeError(
					"tool_execution_failed",
					`${runtimeTool.name} requires SDK run context.`,
				);
			}
			const invocationId = details?.toolCall?.callId;
			if (!invocationId) {
				throw new AgentRuntimeError("tool_execution_failed", "Function call ID is missing.");
			}
			return invokeFunctionTool(
				runtimeTool,
				argumentsJson as Record<string, unknown>,
				context,
				invocationId,
			);
		},
	});
}

function agentRunnerResultFromSDKResult(
	result: RunResult<AgentSdkContext, CampusAgent> | StreamedRunResult<AgentSdkContext, CampusAgent>,
	input: AgentRunnerInput,
) {
	const value =
		input.outputSchema && typeof result.finalOutput === "string"
			? parseModelOutputJSON(result.finalOutput, `workflow.${input.operation}`)
			: result.finalOutput;
	return {
		...normalizedModelOutput(value, input.operation),
		providerResponseId: result.lastResponseId?.trim() ?? "",
		toolResults: toolResultsFromSDKResult(result),
		webEvidence: extractWebEvidence(result),
		webSearchUsed: webSearchUsedFromSDKResult(result),
		usage: usageFromSDK(result.runContext.usage),
	};
}

function toolResultsFromSDKResult(
	result: RunResult<AgentSdkContext, CampusAgent> | StreamedRunResult<AgentSdkContext, CampusAgent>,
): ToolExecutionResult[] {
	const tracked = result.runContext.context.functionToolResults;
	const toolResults: ToolExecutionResult[] = [];
	for (const item of result.newItems) {
		if (item.type !== "tool_call_item" || item.rawItem.type !== "function_call") {
			continue;
		}
		const toolResult = tracked.get(item.rawItem.callId);
		if (!toolResult) {
			throw new Error(`SDK tool call ${item.rawItem.callId} has no execution result`);
		}
		toolResults.push(toolResult);
	}
	return toolResults;
}

function webSearchUsedFromSDKResult(
	result: RunResult<AgentSdkContext, CampusAgent> | StreamedRunResult<AgentSdkContext, CampusAgent>,
): boolean {
	return result.newItems.some((item) => {
		const rawItem = item.rawItem;
		return (
			rawItem?.type === "hosted_tool_call" &&
			(rawItem.name === "web_search_call" ||
				rawItem.providerData?.type === "web_search_call" ||
				rawItem.providerData?.type === "web_search")
		);
	});
}

function extractWebEvidence(
	result: RunResult<AgentSdkContext, CampusAgent> | StreamedRunResult<AgentSdkContext, CampusAgent>,
): WebEvidence[] {
	const evidence: WebEvidence[] = [];
	for (const item of result.newItems) {
		if (item.rawItem.type !== "message" || item.rawItem.role !== "assistant") {
			continue;
		}
		for (const part of item.rawItem.content) {
			if (part.type !== "output_text") {
				continue;
			}
			const annotations = part.providerData?.annotations;
			if (!Array.isArray(annotations)) {
				continue;
			}
			for (const [annotationIndex, annotation] of annotations.entries()) {
				if (!isRecord(annotation) || annotation.type !== "url_citation") {
					continue;
				}
				const url = serializedWebCitationURL(annotation.url);
				const title = stringValue(annotation.title);
				const start = integerValue(annotation.start_index);
				const end = integerValue(annotation.end_index);
				const diagnostic: CitationDiagnostic = {
					schema_version: 1,
					validation_stage: "provider_annotation",
					item_index: annotationIndex,
					text_length: part.text.length,
					offset_unit: "utf16_code_unit",
					...(start === null ? {} : { start }),
					...(end === null ? {} : { end }),
				};
				if (!url) {
					throw citationValidationError(annotation.url ? "invalid_url" : "missing_field", {
						...diagnostic,
						field: "url",
					});
				}
				if (!title) {
					throw citationValidationError("missing_field", { ...diagnostic, field: "title" });
				}
				if (start === null || end === null) {
					const field = start === null ? "start_index" : "end_index";
					const value = annotation[field];
					const actual_type =
						value === undefined
							? "missing"
							: value === null
								? "null"
								: Array.isArray(value)
									? "array"
									: typeof value === "object"
										? "object"
										: typeof value === "number"
											? "number"
											: typeof value === "boolean"
												? "boolean"
												: "string";
					throw citationValidationError("invalid_offset", { ...diagnostic, field, actual_type });
				}
				if (start < 0 || end <= start) {
					throw citationValidationError("invalid_offset", diagnostic);
				}
				if (end > part.text.length) {
					throw citationValidationError("span_out_of_bounds", diagnostic);
				}
				evidence.push({ url, title, excerpt: part.text.slice(start, end) });
			}
		}
	}
	return evidence;
}

function citationValidationError(
	reason: CitationReason,
	citation: CitationDiagnostic,
): AgentRuntimeError {
	return new AgentRuntimeError("citation_validation_failed", CITATION_REASONS[reason], {
		reason,
		citation,
		detail: CITATION_REASONS[reason],
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function integerValue(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function serializedWebCitationURL(value: unknown): string | null {
	if (typeof value !== "string" || value.trim() === "") {
		return null;
	}
	try {
		const url = new URL(value);
		if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hostname === "") {
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
}

function usageFromSDK(usage: Usage) {
	return {
		modelRequestCount: usage.requests,
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		cachedInputTokens: usage.inputTokensDetails.reduce(
			(sum, details) => sum + (details.cached_tokens ?? 0),
			0,
		),
		usageObserved: usage.requests > 0,
	};
}

// This adapter performs one model request. Temporal owns the continuation loop.
export async function runOpenAIModelTurn(
	input: AgentRunnerInput,
	continuation?: import("./model-turn.ts").ProviderContinuation,
	onDelta?: (delta: string) => Promise<void>,
): Promise<import("./model-turn.ts").ModelTurn> {
	// Direct model calls bypass Runner, which normally supplies this SDK context.
	return withTrace(new NoopTrace(), () => requestOpenAIModelTurn(input, continuation, onDelta));
}

async function requestOpenAIModelTurn(
	input: AgentRunnerInput,
	continuation?: import("./model-turn.ts").ProviderContinuation,
	onDelta?: (delta: string) => Promise<void>,
): Promise<import("./model-turn.ts").ModelTurn> {
	const { openAIAgentsRunnerOptionsFromProviderConfig } = await import("./openai-provider.ts");
	const options = openAIAgentsRunnerOptionsFromProviderConfig(input.providerConfig);
	const model = await options.modelProvider!.getModel(options.model!);
	const items: import("@openai/agents").AgentInputItem[] =
		continuation?.provider === "openai"
			? continuation.items
			: input.input.map((m) =>
					m.role === "assistant"
						? {
								role: "assistant",
								status: "completed",
								content: [{ type: "output_text", text: m.content }],
							}
						: { role: "user", content: m.content },
				);
	const request: Parameters<typeof model.getResponse>[0] = {
		systemInstructions: modelInstructions(input),
		input: items,
		modelSettings: modelSettings(input),
		tools: [
			...input.tools.map((t) => ({
				type: "function" as const,
				name: t.name,
				description: t.description,
				parameters: t.parameters ?? emptyParametersSchema,
				strict: true,
			})),
			...(input.allowWebSearch ? [webSearchTool()] : []),
		],
		outputType: "text",
		handoffs: [],
		tracing: false,
		...(input.signal ? { signal: input.signal } : {}),
	};
	let response: Awaited<ReturnType<typeof model.getResponse>>;
	if (input.providerConfig.transport === "responses" || onDelta) {
		let terminal: Awaited<ReturnType<typeof model.getResponse>> | undefined;
		for await (const event of model.getStreamedResponse(request)) {
			if (event.type === "output_text_delta") {
				await onDelta?.(event.delta);
			}
			if (event.type === "response_done") {
				terminal = {
					...event.response,
					usage: new Usage({
						inputTokens: event.response.usage.inputTokens,
						outputTokens: event.response.usage.outputTokens,
						totalTokens: event.response.usage.totalTokens,
						requests: event.response.usage.requests ?? 1,
					}),
					responseId: event.response.id,
				} as Awaited<ReturnType<typeof model.getResponse>>;
			}
		}
		if (!terminal) {
			throw new AgentRuntimeError("run_failed", "Model stream ended without response");
		}
		response = terminal;
	} else {
		response = await model.getResponse(request);
	}
	const calls = response.output.flatMap((item) =>
		item.type === "function_call"
			? [
					{
						id: item.callId,
						name: item.name,
						arguments: JSON.parse(item.arguments) as Record<string, unknown>,
					},
				]
			: [],
	);
	const text = response.output
		.flatMap((item) =>
			item.type === "message" && item.role === "assistant"
				? item.content.flatMap((p) => (p.type === "output_text" ? [p.text] : []))
				: [],
		)
		.join("");
	const pseudo = {
		newItems: response.output.map((rawItem) => ({ rawItem })),
		runContext: { usage: response.usage },
	} as unknown as RunResult<AgentSdkContext, CampusAgent>;
	let normalized: Pick<AgentRunnerResult, "finalOutput" | "structuredOutput"> = { finalOutput: "" };
	let outputFailure: AgentRunnerResult["failure"];
	try {
		if (calls.length === 0) {
			normalized = normalizedModelOutput(
				input.outputSchema ? JSON.parse(text) : text,
				input.operation,
			);
		}
	} catch {
		outputFailure = { code: "model_output_invalid", operation: `workflow.${input.operation}` };
	}
	const result: AgentRunnerResult = {
		...normalized,
		...(outputFailure ? { failure: outputFailure } : {}),
		rawModelOutput: { text, finishReason: null },
		providerResponseId: response.responseId ?? "",
		toolResults: [],
		webEvidence: extractWebEvidence(pseudo),
		webSearchUsed: webSearchUsedFromSDKResult(pseudo),
		usage: usageFromSDK(response.usage),
	};
	return {
		continuation: { provider: "openai", items: [...items, ...response.output] },
		calls,
		result,
	};
}
