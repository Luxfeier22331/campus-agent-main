import { isDeepStrictEqual } from "node:util";
import {
	Agent,
	type AgentInputItem,
	type AgentOutputType,
	type ModelProvider,
	Runner,
	type Tool,
	tool,
} from "@openai/agents";
import { z } from "zod";
import type {
	AgentRunner,
	AgentRunnerAnswerDelta,
	AgentRunnerInput,
	PromptProviderRuntimeConfig,
	RunnerToolCall,
	StreamingAgentRunner,
	ToolExecutionResult,
	UntimedToolExecutionResult,
} from "./primary-agent.ts";
import { finalOutputFromTerminalEnvelope, terminalEnvelopeFromUnknown } from "./primary-agent.ts";
import type { JsonObjectSchema } from "./tool-catalog.ts";

const emptyParametersSchema = {
	type: "object" as const,
	additionalProperties: false as const,
	properties: {},
	required: [],
};

const primaryAgentTerminalOutputSchema = z.object({
	kind: z.enum([
		"answer",
		"clarification_required",
		"out_of_scope",
		"policy_refusal",
		"unsupported_by_evidence",
	]),
	answerText: z.string().min(1).optional(),
	followUpQuestion: z.string().optional(),
	reason: z.string().optional(),
	evidenceRefs: z.array(z.string().min(1)).optional(),
});

interface AgentSdkContext {
	runId: string;
	requestId: string;
	traceId: string;
	toolBudget: {
		limit: number;
		reserved: number;
	};
}

export interface OpenAIAgentsRunnerOptions {
	runSdk?: OpenAIAgentsRunFunction;
	runSdkStream?: OpenAIAgentsStreamRunFunction;
	model?: string;
	modelProvider?: ModelProvider;
	resolveRuntimeOptions?: (
		providerConfig: PromptProviderRuntimeConfig,
	) => Pick<OpenAIAgentsRunnerOptions, "model" | "modelProvider">;
}

export type OpenAIAgentsRunFunction = <TOutput extends AgentOutputType>(
	agent: Agent<AgentSdkContext, TOutput>,
	input: AgentInputItem[],
	options: {
		context: AgentSdkContext;
		maxTurns: number;
		modelProvider?: ModelProvider;
		traceId: string;
		traceMetadata: Record<string, string>;
		workflowName: string;
		traceIncludeSensitiveData: boolean;
		signal?: AbortSignal;
	},
) => Promise<OpenAIAgentsRunResultLike>;

export type OpenAIAgentsStreamRunFunction = <TOutput extends AgentOutputType>(
	agent: Agent<AgentSdkContext, TOutput>,
	input: AgentInputItem[],
	options: {
		context: AgentSdkContext;
		maxTurns: number;
		modelProvider?: ModelProvider;
		traceId: string;
		traceMetadata: Record<string, string>;
		workflowName: string;
		traceIncludeSensitiveData: boolean;
		signal?: AbortSignal;
	},
) => Promise<OpenAIAgentsStreamRunResultLike>;

interface OpenAIAgentsRunResultLike {
	currentAgent?: { name?: string };
	finalOutput?: unknown;
	lastAgent?: { name?: string };
	lastResponseId?: string;
	newItems?: unknown[];
	rawResponses?: unknown[];
	state?: {
		_trace?: { traceId?: string };
		_context?: { usage?: UsageLike };
		context?: { usage?: UsageLike };
		usage?: UsageLike;
	};
	trace?: { traceId?: string };
	usage?: UsageLike;
}

interface OpenAIAgentsStreamRunResultLike extends OpenAIAgentsRunResultLike {
	cancelled?: boolean;
	completed: Promise<void>;
	error?: unknown;
	toTextStream(): ReadableStream<string>;
}

interface UsageLike {
	requests?: number;
	inputTokens?: number;
	outputTokens?: number;
	cachedInputTokens?: number;
	inputTokensDetails?: Record<string, number>[] | Record<string, number>;
}

export function createOpenAIAgentsRunner(options: OpenAIAgentsRunnerOptions = {}): AgentRunner {
	const runSdk = options.runSdk ?? defaultRunSdk;
	return async (input) => {
		const requestOptions =
			options.resolveRuntimeOptions?.(input.providerConfig) ??
			({
				model: options.model,
				modelProvider: options.modelProvider,
			} satisfies Pick<OpenAIAgentsRunnerOptions, "model" | "modelProvider">);
		const runtime = createSdkRuntime(input, requestOptions.model?.trim() || undefined);
		const result = await runSdk(runtime.agent, input.input, {
			context: runtime.context,
			maxTurns: input.limits.maxTurns,
			modelProvider: requestOptions.modelProvider,
			traceId: input.traceId,
			traceMetadata: agentTraceMetadata(input),
			workflowName: "campus-agent.primary-agent",
			traceIncludeSensitiveData: false,
			signal: input.signal,
		});
		return agentRunnerResultFromSDKResult(result);
	};
}

export function createStreamingOpenAIAgentsRunner(
	options: OpenAIAgentsRunnerOptions = {},
): StreamingAgentRunner {
	const runSdkStream = options.runSdkStream ?? defaultRunSdkStream;
	return async function* (input) {
		const requestOptions =
			options.resolveRuntimeOptions?.(input.providerConfig) ??
			({
				model: options.model,
				modelProvider: options.modelProvider,
			} satisfies Pick<OpenAIAgentsRunnerOptions, "model" | "modelProvider">);
		const runtime = createSdkRuntime(input, requestOptions.model?.trim() || undefined);
		const result = await runSdkStream(runtime.agent, input.input, {
			context: runtime.context,
			maxTurns: input.limits.maxTurns,
			modelProvider: requestOptions.modelProvider,
			traceId: input.traceId,
			traceMetadata: agentTraceMetadata(input),
			workflowName: "campus-agent.primary-agent",
			traceIncludeSensitiveData: false,
			signal: input.signal,
		});
		let rawOutputText = "";
		let accumulatedVisibleText = "";
		let chunkIndex = 0;
		for await (const delta of result.toTextStream()) {
			if (delta === "") {
				continue;
			}
			rawOutputText += delta;
			const nextVisibleText = visibleTextFromPartialTerminalOutput(rawOutputText);
			if (nextVisibleText === accumulatedVisibleText) {
				continue;
			}
			if (!nextVisibleText.startsWith(accumulatedVisibleText)) {
				throw new Error("streamed terminal output visible text drifted");
			}
			const visibleDelta = nextVisibleText.slice(accumulatedVisibleText.length);
			accumulatedVisibleText = nextVisibleText;
			if (visibleDelta.trim() === "" || nextVisibleText.trim() === "") {
				continue;
			}
			chunkIndex += 1;
			yield {
				accumulatedText: accumulatedVisibleText,
				chunkIndex,
				delta: visibleDelta,
			} satisfies AgentRunnerAnswerDelta;
		}
		await result.completed;
		throwIfStreamRunDidNotComplete(result, input.signal);
		const finalResult = agentRunnerResultFromSDKResult(result);
		if (accumulatedVisibleText !== "") {
			if (!finalResult.finalOutput.startsWith(accumulatedVisibleText)) {
				throw new Error("streamed answer text drifted from final output");
			}
			const tail = finalResult.finalOutput.slice(accumulatedVisibleText.length);
			if (tail.trim() !== "") {
				chunkIndex += 1;
				yield {
					accumulatedText: finalResult.finalOutput,
					chunkIndex,
					delta: tail,
				} satisfies AgentRunnerAnswerDelta;
			}
		}
		yield finalResult;
	};
}

function throwIfStreamRunDidNotComplete(
	result: OpenAIAgentsStreamRunResultLike,
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

function agentTraceMetadata(input: AgentRunnerInput): Record<string, string> {
	return {
		"campus.trace_id": input.traceId,
		"request.id": input.requestId,
		"run.id": input.runId,
	};
}

function createSdkRuntime(input: AgentRunnerInput, model: string | undefined) {
	const context: AgentSdkContext = {
		runId: input.runId,
		requestId: input.requestId,
		traceId: input.traceId,
		toolBudget: {
			limit: input.limits.maxToolCalls,
			reserved: 0,
		},
	};
	const sdkTools = input.tools.map((runtimeTool) => sdkTool(runtimeTool));
	const agent = Agent.create({
		name: "Campus primary assistant",
		instructions: input.instructions,
		model,
		modelSettings: { maxTokens: input.limits.maxOutputTokens },
		outputType: primaryAgentTerminalOutputSchema,
		// Agent.create in SDK 0.13.0 hard-codes unknown context.
		tools: sdkTools as unknown as Tool<unknown>[],
	}) as Agent<AgentSdkContext, typeof primaryAgentTerminalOutputSchema>;
	return { agent, context };
}

function sdkTool(runtimeTool: AgentRunnerInput["tools"][number]) {
	return tool<JsonObjectSchema, AgentSdkContext>({
		name: runtimeTool.name,
		description: runtimeTool.description,
		parameters: runtimeTool.parameters ?? emptyParametersSchema,
		strict: true,
		isEnabled: ({ runContext }) =>
			runContext.context.toolBudget.reserved < runContext.context.toolBudget.limit,
		async execute(argumentsJson, runContext, details) {
			const startedAt = performance.now();
			const complete = (result: UntimedToolExecutionResult): ToolExecutionResult => ({
				...result,
				durationMs: Math.max(0.001, performance.now() - startedAt),
			});
			const parsedArguments = recordFromToolArguments(argumentsJson);
			const context = runContext?.context;
			if (context === undefined) {
				throw new Error(`${runtimeTool.name} requires SDK run context`);
			}
			if (context.toolBudget.reserved >= context.toolBudget.limit) {
				return complete(toolCallBudgetExhaustedResult(runtimeTool.name, parsedArguments, context));
			}
			context.toolBudget.reserved += 1;
			const result = await runtimeTool.execute(parsedArguments, {
				invocationId: details?.toolCall?.callId,
			});
			return complete(result);
		},
	});
}

function toolCallBudgetExhaustedResult(
	toolName: string,
	argumentsJson: Record<string, unknown>,
	context: AgentSdkContext,
): UntimedToolExecutionResult {
	return {
		status: "failed",
		toolName,
		payloadKind: toolName,
		argumentsJson,
		failCloseReason: "tool_call_budget_exhausted",
		result: { error: "The admitted tool call budget is exhausted." },
		resultRef: `agent-runtime://${context.runId}/tools/${toolName}/budget-exhausted`,
	};
}

function recordFromToolArguments(value: unknown): Record<string, unknown> {
	const record = recordFromUnknown(value);
	return record ?? {};
}

const defaultRunSdk: OpenAIAgentsRunFunction = async (agent, input, options) => {
	const runner = new Runner({
		modelProvider: options.modelProvider,
		traceId: options.traceId,
		traceMetadata: options.traceMetadata,
		workflowName: options.workflowName,
		traceIncludeSensitiveData: options.traceIncludeSensitiveData,
	});
	return runner.run(agent, input, {
		context: options.context,
		maxTurns: options.maxTurns,
		signal: options.signal,
	}) as Promise<OpenAIAgentsRunResultLike>;
};

const defaultRunSdkStream: OpenAIAgentsStreamRunFunction = async (agent, input, options) => {
	const runner = new Runner({
		modelProvider: options.modelProvider,
		traceId: options.traceId,
		traceMetadata: options.traceMetadata,
		workflowName: options.workflowName,
		traceIncludeSensitiveData: options.traceIncludeSensitiveData,
	});
	return runner.run(agent, input, {
		context: options.context,
		maxTurns: options.maxTurns,
		signal: options.signal,
		stream: true,
	}) as unknown as Promise<OpenAIAgentsStreamRunResultLike>;
};

function agentRunnerResultFromSDKResult(result: OpenAIAgentsRunResultLike) {
	const terminalEnvelope = terminalEnvelopeFromUnknown(result.finalOutput);
	const toolCalls = toolCallsFromItems(result.newItems ?? []);
	return {
		finalOutput:
			terminalEnvelope === undefined
				? String(result.finalOutput ?? "")
				: finalOutputFromTerminalEnvelope(terminalEnvelope),
		providerResponseId: providerResponseIDFromResult(result),
		terminalEnvelope,
		toolCalls,
		usage: usageFromResult(result),
	};
}

function visibleTextFromPartialTerminalOutput(value: string): string {
	try {
		const envelope = terminalEnvelopeFromUnknown(JSON.parse(value));
		return envelope === undefined ? "" : finalOutputFromTerminalEnvelope(envelope);
	} catch {
		// Continue with bounded partial extraction below.
	}
	const kind = extractJsonStringFieldPrefix(value, ["kind"]).value;
	if (kind === undefined) {
		return "";
	}
	switch (kind) {
		case "answer":
			return trimStringValue(extractJsonStringFieldPrefix(value, ["answerText"]).value);
		case "clarification_required":
			return trimStringValue(extractJsonStringFieldPrefix(value, ["followUpQuestion"]).value);
		case "out_of_scope":
		case "policy_refusal":
		case "unsupported_by_evidence":
			return trimStringValue(extractJsonStringFieldPrefix(value, ["answerText"]).value);
		default:
			return "";
	}
}

function trimStringValue(value: string | undefined): string {
	return value?.trim() ?? "";
}

function extractJsonStringFieldPrefix(
	value: string,
	fieldNames: string[],
): { complete: boolean; value?: string } {
	for (const fieldName of fieldNames) {
		const match = new RegExp(`"${fieldName}"\\s*:`).exec(value);
		if (!match) {
			continue;
		}
		let index = match.index + match[0].length;
		while (index < value.length && /\s/.test(value[index] ?? "")) {
			index += 1;
		}
		if (value[index] !== '"') {
			continue;
		}
		return extractJsonStringPrefix(value, index + 1);
	}
	return { complete: false };
}

function extractJsonStringPrefix(
	value: string,
	startIndex: number,
): { complete: boolean; value: string } {
	let decoded = "";
	for (let index = startIndex; index < value.length; index += 1) {
		const char = value[index];
		if (char === '"') {
			return { complete: true, value: decoded };
		}
		if (char !== "\\") {
			decoded += char;
			continue;
		}
		const escaped = value[index + 1];
		if (escaped === undefined) {
			break;
		}
		switch (escaped) {
			case '"':
			case "\\":
			case "/":
				decoded += escaped;
				index += 1;
				continue;
			case "b":
				decoded += "\b";
				index += 1;
				continue;
			case "f":
				decoded += "\f";
				index += 1;
				continue;
			case "n":
				decoded += "\n";
				index += 1;
				continue;
			case "r":
				decoded += "\r";
				index += 1;
				continue;
			case "t":
				decoded += "\t";
				index += 1;
				continue;
			case "u": {
				const hex = value.slice(index + 2, index + 6);
				if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
					return { complete: false, value: decoded };
				}
				decoded += String.fromCharCode(Number.parseInt(hex, 16));
				index += 5;
				continue;
			}
			default:
				return { complete: false, value: decoded };
		}
	}
	return { complete: false, value: decoded };
}

function providerResponseIDFromResult(result: OpenAIAgentsRunResultLike): string {
	const responseID = result.lastResponseId ?? lastStringID(result.rawResponses ?? []);
	return responseID?.trim() ?? "";
}

function usageFromResult(result: OpenAIAgentsRunResultLike) {
	const usage =
		result.usage ??
		result.state?.usage ??
		result.state?._context?.usage ??
		result.state?.context?.usage;
	if (usage === undefined) {
		return {
			modelRequestCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			cachedInputTokens: 0,
			usageObserved: false,
		};
	}
	return {
		modelRequestCount: integerOrZero(usage.requests),
		inputTokens: integerOrZero(usage.inputTokens),
		outputTokens: integerOrZero(usage.outputTokens),
		cachedInputTokens: cachedInputTokensFromUsage(usage),
		usageObserved:
			usage.requests !== undefined ||
			usage.inputTokens !== undefined ||
			usage.outputTokens !== undefined ||
			usage.cachedInputTokens !== undefined ||
			usage.inputTokensDetails !== undefined,
	};
}

function cachedInputTokensFromUsage(usage: UsageLike): number {
	if (usage.cachedInputTokens !== undefined) {
		return integerOrZero(usage.cachedInputTokens);
	}
	const details = usage.inputTokensDetails;
	if (Array.isArray(details)) {
		return details.reduce((sum, entry) => sum + integerOrZero(entry.cached_tokens), 0);
	}
	return integerOrZero(details?.cached_tokens);
}

function toolCallsFromItems(items: unknown[]): RunnerToolCall[] {
	const calls: RunnerToolCall[] = [];
	const seenInvocationIDs = new Set<string>();
	for (const rawItemValue of items) {
		const item = recordFromUnknown(rawItemValue);
		if (item?.type !== "tool_call_item") {
			continue;
		}
		const rawItem = recordFromUnknown(item.rawItem);
		const name = stringFromUnknown(rawItem?.name);
		if (name === "") {
			continue;
		}
		const callID = stringFromUnknown(rawItem?.callId);
		if (callID === "") {
			throw new Error(`SDK tool call ${name} is missing its invocation ID`);
		}
		if (seenInvocationIDs.has(callID)) {
			throw new Error(`SDK tool invocation ${callID} is duplicated`);
		}
		seenInvocationIDs.add(callID);
		const argumentsSummary = argumentsSummaryFromRawItem(rawItem);
		const result = outputResultForCall(items, callID);
		if (result === undefined) {
			throw new Error(`SDK tool call ${name} has no exact result for invocation ${callID}`);
		}
		if (result.toolName !== name || result.payloadKind !== name) {
			throw new Error(`SDK tool call ${name} result identity does not match invocation ${callID}`);
		}
		if (
			result.argumentsJson === undefined ||
			!isDeepStrictEqual(result.argumentsJson, argumentsSummary)
		) {
			throw new Error(`SDK tool call ${name} result arguments do not match invocation ${callID}`);
		}
		calls.push({
			name,
			argumentsSummary,
			result,
		});
	}
	return calls;
}

function outputResultForCall(items: unknown[], callID: string): ToolExecutionResult | undefined {
	let matchedOutput: Record<string, unknown> | undefined;
	for (const item of items) {
		const candidate = recordFromUnknown(item);
		if (candidate?.type !== "tool_call_output_item") {
			continue;
		}
		const rawItem = recordFromUnknown(candidate.rawItem);
		if (stringFromUnknown(rawItem?.callId) !== callID) {
			continue;
		}
		if (matchedOutput !== undefined) {
			throw new Error(`SDK tool invocation ${callID} has multiple result items`);
		}
		matchedOutput = candidate;
	}
	return matchedOutput === undefined ? undefined : toolResultFromOutput(matchedOutput);
}

function toolResultFromOutput(value: unknown): ToolExecutionResult | undefined {
	const item = recordFromUnknown(value);
	const rawItem = recordFromUnknown(item?.rawItem);
	for (const output of [item?.output, rawItem?.output]) {
		const result = toolResultFromValue(output);
		if (result !== undefined) {
			return result;
		}
	}
	return;
}

function toolResultFromValue(output: unknown): ToolExecutionResult | undefined {
	if (isToolExecutionResult(output)) {
		return output;
	}
	if (typeof output === "string") {
		try {
			const parsed = JSON.parse(output);
			return isToolExecutionResult(parsed) ? parsed : undefined;
		} catch {
			return;
		}
	}
	const textOutput = recordFromUnknown(output);
	if (typeof textOutput?.text !== "string") {
		return;
	}
	try {
		const parsed = JSON.parse(textOutput.text);
		return isToolExecutionResult(parsed) ? parsed : undefined;
	} catch {
		return;
	}
}

function argumentsSummaryFromRawItem(
	rawItem: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const rawArguments = rawItem?.arguments;
	if (recordFromUnknown(rawArguments) !== undefined) {
		return rawArguments as Record<string, unknown>;
	}
	if (typeof rawArguments !== "string") {
		return {};
	}
	try {
		const parsed = JSON.parse(rawArguments);
		return recordFromUnknown(parsed) ?? {};
	} catch {
		return {};
	}
}

function isToolExecutionResult(value: unknown): value is ToolExecutionResult {
	const candidate = recordFromUnknown(value);
	return (
		candidate !== undefined &&
		(candidate.status === "completed" || candidate.status === "failed") &&
		typeof candidate.durationMs === "number" &&
		Number.isFinite(candidate.durationMs) &&
		candidate.durationMs > 0 &&
		stringFromUnknown(candidate.toolName) !== "" &&
		stringFromUnknown(candidate.payloadKind) !== "" &&
		(candidate.argumentsJson === undefined ||
			recordFromUnknown(candidate.argumentsJson) !== undefined) &&
		recordFromUnknown(candidate.result) !== undefined &&
		stringFromUnknown(candidate.resultRef) !== "" &&
		(candidate.status !== "failed" || stringFromUnknown(candidate.failCloseReason) !== "")
	);
}

function lastStringID(values: unknown[]): string | undefined {
	for (let index = values.length - 1; index >= 0; index--) {
		const value = values[index];
		const id = stringFromUnknown(recordFromUnknown(value)?.id);
		if (id !== "") {
			return id;
		}
	}
	return;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function stringFromUnknown(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function integerOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}
