import {
	Agent,
	type AgentOptions,
	type AgentOutputType,
	type AssistantMessageItem,
	type ModelProvider,
	Runner,
	type RunResult,
	type StreamedRunResult,
	tool,
	type Usage,
	webSearchTool,
} from "@openai/agents";
import type {
	AgentRunner,
	AgentRunnerAnswerDelta,
	AgentRunnerInput,
	AgentRunnerResult,
	AgentRunnerSolveDecision,
	PromptProviderRuntimeConfig,
	SdkToolRuntime,
	StreamingAgentRunner,
	ToolExecutionResult,
	WebCitation,
} from "./agent-run-contract.ts";
import { AgentRuntimeError } from "./runtime-errors.ts";
import type { JsonObjectSchema } from "./tool-catalog.ts";

const emptyParametersSchema = {
	type: "object" as const,
	additionalProperties: false as const,
	properties: {},
	required: [],
};

interface AgentSdkContext {
	campusSearch: {
		nextCitationIndex: number;
		queue: Promise<void>;
	};
	functionToolBudget: {
		limit: number;
		reserved: number;
	};
	functionToolResults: Map<string, ToolExecutionResult>;
}

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
		const requestOptions = resolveRequestOptions(options, input.providerConfig);
		const runtime = createSdkRuntime(input, requestOptions.model?.trim() || undefined);
		const runner = createSdkRunner(requestOptions.modelProvider, input.operation);
		const result = await runner.run(runtime.agent, input.input, {
			context: runtime.context,
			maxTurns: input.limits.maxTurns,
			...(input.signal ? { signal: input.signal } : {}),
		});
		return agentRunnerResultFromSDKResult(result, input.operation);
	};
}

export function createStreamingOpenAIAgentsRunner(
	options: OpenAIAgentsRunnerOptions = {},
): StreamingAgentRunner {
	return async function* (input) {
		const requestOptions = resolveRequestOptions(options, input.providerConfig);
		const runtime = createSdkRuntime(input, requestOptions.model?.trim() || undefined);
		const runner = createSdkRunner(requestOptions.modelProvider, input.operation);
		const result = await runner.run(runtime.agent, input.input, {
			context: runtime.context,
			maxTurns: input.limits.maxTurns,
			...(input.signal ? { signal: input.signal } : {}),
			stream: true,
		});
		if (input.operation === "solve") {
			yield* streamSolveResult(result, input);
			return;
		}
		for await (const delta of result.toTextStream()) {
			if (delta !== "") {
				yield { delta } satisfies AgentRunnerAnswerDelta;
			}
		}
		await result.completed;
		throwIfStreamRunDidNotComplete(result, input.signal);
		yield agentRunnerResultFromSDKResult(result, input.operation);
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
	const finalResult = agentRunnerResultFromSDKResult(result, input.operation);
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

function partialJSONStringField(serialized: string, field: string): string | undefined {
	const fieldPattern = new RegExp(`"${field}"\\s*:\\s*"`, "u");
	const match = fieldPattern.exec(serialized);
	if (!match) {
		return undefined;
	}
	const start = match.index + match[0].length;
	let value = "";
	for (let index = start; index < serialized.length; index += 1) {
		const character = serialized[index];
		if (character === '"') {
			return value;
		}
		if (character !== "\\") {
			value += character;
			continue;
		}
		if (index + 1 >= serialized.length) {
			return value;
		}
		const escapeCharacter = serialized[index + 1];
		if (escapeCharacter === undefined) {
			return value;
		}
		switch (escapeCharacter) {
			case '"':
			case "\\":
			case "/":
				value += escapeCharacter;
				index += 1;
				break;
			case "b":
				value += "\b";
				index += 1;
				break;
			case "f":
				value += "\f";
				index += 1;
				break;
			case "n":
				value += "\n";
				index += 1;
				break;
			case "r":
				value += "\r";
				index += 1;
				break;
			case "t":
				value += "\t";
				index += 1;
				break;
			case "u": {
				const hex = serialized.slice(index + 2, index + 6);
				if (!/^[0-9a-f]{4}$/iu.test(hex)) {
					return value;
				}
				value += String.fromCharCode(Number.parseInt(hex, 16));
				index += 5;
				break;
			}
			default:
				return value;
		}
	}
	return value;
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
	const context: AgentSdkContext = {
		campusSearch: { nextCitationIndex: input.citationStart, queue: Promise.resolve() },
		functionToolBudget: {
			limit: input.limits.maxFunctionToolCalls,
			reserved: 0,
		},
		functionToolResults: new Map(),
	};
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
		instructions: input.instructions,
		...(input.outputType ? { outputType: input.outputType } : {}),
		...(model ? { model } : {}),
		modelSettings: { maxTokens: input.limits.maxOutputTokens },
		tools: [...input.tools.map((runtimeTool) => sdkTool(runtimeTool)), ...hostedTools],
	};
	const agent = new Agent<AgentSdkContext, AgentOutputType>(agentConfig);
	return { agent, context };
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
			if (context.functionToolBudget.reserved >= context.functionToolBudget.limit) {
				throw new AgentRuntimeError(
					"tool_execution_failed",
					"The admitted function tool call budget is exhausted.",
				);
			}
			const invocationId = details?.toolCall?.callId;
			if (!invocationId) {
				throw new AgentRuntimeError(
					"tool_execution_failed",
					`${runtimeTool.name} is missing its SDK call ID.`,
				);
			}
			context.functionToolBudget.reserved += 1;
			const startedAt = new Date().toISOString();
			const startedAtMonotonic = performance.now();
			const parsedArguments = argumentsJson as Record<string, unknown>;
			const result = await executeSdkTool(runtimeTool, parsedArguments, context, invocationId);
			const completedAt = new Date().toISOString();
			context.functionToolResults.set(invocationId, {
				...result,
				argumentsJson: parsedArguments,
				durationMs: Math.max(0.001, performance.now() - startedAtMonotonic),
				startedAt,
				completedAt,
				toolName: runtimeTool.name,
				invocationId,
			});
			return result;
		},
	});
}

async function executeSdkTool(
	runtimeTool: AgentRunnerInput["tools"][number],
	argumentsJson: Record<string, unknown>,
	context: AgentSdkContext,
	invocationId: string,
) {
	if (runtimeTool.name !== "campus_search") {
		return runtimeTool.execute(argumentsJson, { invocationId });
	}
	const previous = context.campusSearch.queue;
	let release: () => void = () => undefined;
	context.campusSearch.queue = new Promise<void>((resolve) => {
		release = resolve;
	});
	await previous;
	try {
		const citationStart = context.campusSearch.nextCitationIndex;
		if (citationStart > 10) {
			return {
				failure: {
					code: "campus_search_result_budget_exhausted",
					operation: "tool.campus_search",
					detail: "campus search result budget is exhausted",
					invocationId,
				},
				result: { error: "campus search result budget is exhausted" },
				status: "failed" as const,
			};
		}
		const resultLimit = Math.min(5, 11 - citationStart);
		const result = await runtimeTool.execute(argumentsJson, {
			citationStart,
			invocationId,
			resultLimit,
		});
		context.campusSearch.nextCitationIndex += campusSearchResultCount(
			result,
			citationStart,
			resultLimit,
		);
		return result;
	} finally {
		release();
	}
}

function campusSearchResultCount(
	result: Awaited<ReturnType<SdkToolRuntime["execute"]>>,
	citationStart: number,
	resultLimit: number,
): number {
	if (result.status !== "completed") {
		return 0;
	}
	const results = result.result.results;
	if (!Array.isArray(results) || results.length > resultLimit) {
		throw new AgentRuntimeError(
			"tool_execution_failed",
			"campus_search returned an invalid result list.",
		);
	}
	for (const [offset, item] of results.entries()) {
		if (
			item === null ||
			typeof item !== "object" ||
			(item as Record<string, unknown>).citation_index !== citationStart + offset
		) {
			throw new AgentRuntimeError(
				"tool_execution_failed",
				"campus_search returned invalid citation indexes.",
			);
		}
	}
	return results.length;
}

function agentRunnerResultFromSDKResult(
	result: RunResult<AgentSdkContext, CampusAgent> | StreamedRunResult<AgentSdkContext, CampusAgent>,
	operation: AgentRunnerInput["operation"],
) {
	const sdkOutput = result.finalOutput;
	const rawFinalOutput =
		operation === "solve" && isRecord(sdkOutput) ? sdkOutput.result : sdkOutput;
	const finalOutput = textOutputFromSDKResult(rawFinalOutput, operation);
	return {
		finalOutput,
		...(isRecord(rawFinalOutput) ? { structuredOutput: rawFinalOutput } : {}),
		providerResponseId: result.lastResponseId?.trim() ?? "",
		toolResults: toolResultsFromSDKResult(result),
		webCitations: extractWebCitations(result),
		webSearchUsed: webSearchUsedFromSDKResult(result),
		usage: usageFromSDK(result.runContext.usage),
	};
}

function textOutputFromSDKResult(value: unknown, operation: AgentRunnerInput["operation"]): string {
	if (typeof value === "string") {
		return value;
	}
	if (
		operation === "solve" &&
		isRecord(value) &&
		value.outcome === "answer" &&
		typeof value.answer === "string"
	) {
		return value.answer;
	}
	return "";
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

function extractWebCitations(
	result: RunResult<AgentSdkContext, CampusAgent> | StreamedRunResult<AgentSdkContext, CampusAgent>,
): WebCitation[] {
	const finalOutput = typeof result.finalOutput === "string" ? result.finalOutput : "";
	if (finalOutput === "") {
		return [];
	}
	const finalMessages = messagesForFinalOutput(result, finalOutput);
	if (finalMessages.length === 0) {
		return [];
	}

	const citations: WebCitation[] = [];
	let partOffset = 0;
	for (const message of finalMessages) {
		for (const content of outputTextContents(message)) {
			const annotations = content.providerData?.annotations;
			if (annotations === undefined) {
				partOffset += [...content.text].length;
				continue;
			}
			if (!Array.isArray(annotations)) {
				throw citationValidationError("output text annotations must be an array");
			}
			for (const annotation of annotations) {
				if (!isRecord(annotation)) {
					throw citationValidationError("web citation annotation must be an object");
				}
				if (annotation.type !== "url_citation") {
					continue;
				}
				const startIndex = integerValue(annotation.start_index);
				const endIndex = integerValue(annotation.end_index);
				const title = stringValue(annotation.title);
				const url = serializedWebCitationURL(annotation.url);
				if (
					startIndex === null ||
					endIndex === null ||
					startIndex < 0 ||
					endIndex <= startIndex ||
					!title ||
					!url
				) {
					throw citationValidationError("web citation annotation fields are invalid");
				}
				if (endIndex > content.text.length) {
					throw citationValidationError("web citation annotation is outside its text part");
				}
				const startCodePoint = codePointOffsetFromUtf16(content.text, startIndex);
				const endCodePoint = codePointOffsetFromUtf16(content.text, endIndex);
				if (startCodePoint === null || endCodePoint === null || endCodePoint <= startCodePoint) {
					throw citationValidationError("web citation annotation splits a code point");
				}
				citations.push({
					startIndex: partOffset + startCodePoint,
					endIndex: partOffset + endCodePoint,
					title,
					url,
				});
			}
			partOffset += [...content.text].length;
		}
	}
	return citations;
}

function messagesForFinalOutput(
	result: RunResult<AgentSdkContext, CampusAgent> | StreamedRunResult<AgentSdkContext, CampusAgent>,
	finalOutput: string,
): AssistantMessageItem[] {
	const messages = result.newItems.flatMap((item) =>
		item.type === "message_output_item" && item.rawItem?.type === "message" ? [item.rawItem] : [],
	);
	const matched: AssistantMessageItem[] = [];
	let matchedText = "";
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message) {
			continue;
		}
		matched.unshift(message);
		matchedText = assistantMessageText(message) + matchedText;
		if (matchedText === finalOutput) {
			return matched;
		}
		if (!finalOutput.endsWith(matchedText)) {
			return [];
		}
	}
	return [];
}

function assistantMessageText(message: unknown): string {
	return outputTextContents(message)
		.map((content) => content.text)
		.join("");
}

function outputTextContents(
	message: unknown,
): Array<{ text: string; providerData?: Record<string, unknown> }> {
	if (!(isRecord(message) && Array.isArray(message.content))) {
		return [];
	}
	return message.content.flatMap((content) => {
		if (!isRecord(content) || content.type !== "output_text" || typeof content.text !== "string") {
			return [];
		}
		return [
			{
				text: content.text,
				...(isRecord(content.providerData) ? { providerData: content.providerData } : {}),
			},
		];
	});
}

function citationValidationError(message: string): AgentRuntimeError {
	return new AgentRuntimeError("citation_validation_failed", message);
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

function codePointOffsetFromUtf16(text: string, offset: number): number | null {
	if (offset < 0 || offset > text.length) {
		return null;
	}
	const prefix = text.slice(0, offset);
	const last = prefix.charCodeAt(prefix.length - 1);
	if (last >= 0xd800 && last <= 0xdbff) {
		return null;
	}
	return [...prefix].length;
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
