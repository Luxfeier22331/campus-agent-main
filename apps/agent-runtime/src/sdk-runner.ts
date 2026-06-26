import { Agent, type AgentOutputType, type ModelProvider, Runner, tool } from "@openai/agents";
import { z } from "zod";
import type {
	AgentRunner,
	AgentRunnerAnswerDelta,
	PromptProviderRuntimeConfig,
	RunnerToolCall,
	StreamingAgentRunner,
	ToolExecutionResult,
} from "./primary-agent.ts";
import { finalOutputFromTerminalEnvelope, terminalEnvelopeFromUnknown } from "./primary-agent.ts";

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
});

export interface OpenAIAgentsRunnerOptions {
	runSdk?: OpenAIAgentsRunFunction;
	runSdkStream?: OpenAIAgentsStreamRunFunction;
	maxTurns?: number;
	model?: string;
	modelProvider?: ModelProvider;
	resolveRuntimeOptions?: (
		providerConfig: PromptProviderRuntimeConfig,
	) => Pick<OpenAIAgentsRunnerOptions, "model" | "modelProvider">;
}

export type OpenAIAgentsRunFunction = <TOutput extends AgentOutputType>(
	agent: Agent<unknown, TOutput>,
	input: string,
	options: {
		maxTurns: number;
		modelProvider?: ModelProvider;
		traceId: string;
		workflowName: string;
		traceIncludeSensitiveData: boolean;
		signal?: AbortSignal;
	},
) => Promise<OpenAIAgentsRunResultLike>;

export type OpenAIAgentsStreamRunFunction = <TOutput extends AgentOutputType>(
	agent: Agent<unknown, TOutput>,
	input: string,
	options: {
		maxTurns: number;
		modelProvider?: ModelProvider;
		traceId: string;
		workflowName: string;
		traceIncludeSensitiveData: boolean;
		signal?: AbortSignal;
	},
) => Promise<OpenAIAgentsStreamRunResultLike>;

interface OpenAIAgentsRunResultLike {
	finalOutput?: unknown;
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
	completed: Promise<void>;
	toTextStream(): ReadableStream<string>;
}

interface UsageLike {
	inputTokens?: number;
	outputTokens?: number;
	cachedInputTokens?: number;
	inputTokensDetails?: Record<string, number>[] | Record<string, number>;
}

export function createOpenAIAgentsRunner(options: OpenAIAgentsRunnerOptions = {}): AgentRunner {
	const runSdk = options.runSdk ?? defaultRunSdk;
	const maxTurns = options.maxTurns ?? 4;
	return async (input) => {
		const requestOptions =
			options.resolveRuntimeOptions?.(input.providerConfig) ??
			({
				model: options.model,
				modelProvider: options.modelProvider,
			} satisfies Pick<OpenAIAgentsRunnerOptions, "model" | "modelProvider">);
		const sdkTools = input.tools.map((runtimeTool) =>
			tool({
				name: runtimeTool.name,
				description: runtimeTool.description,
				parameters: runtimeTool.parameters ?? emptyParametersSchema,
				strict: true,
				async execute(argumentsJson) {
					return runtimeTool.execute(recordFromToolArguments(argumentsJson));
				},
			}),
		);
		const agent = new Agent({
			name: "Campus primary assistant",
			instructions: input.instructions,
			model: requestOptions.model?.trim() || undefined,
			outputType: primaryAgentTerminalOutputSchema,
			tools: sdkTools,
		});
		const result = await runSdk(agent, input.input, {
			maxTurns,
			modelProvider: requestOptions.modelProvider,
			traceId: input.traceId,
			workflowName: "campus-agent.primary-agent",
			traceIncludeSensitiveData: false,
			signal: input.signal,
		});
		const terminalEnvelope = terminalEnvelopeFromUnknown(result.finalOutput);
		return {
			finalOutput:
				terminalEnvelope === undefined
					? String(result.finalOutput ?? "")
					: finalOutputFromTerminalEnvelope(terminalEnvelope),
			providerResponseId: providerResponseIDFromResult(result),
			terminalEnvelope,
			toolCalls: toolCallsFromItems(result.newItems ?? []),
			traceRef: traceRefFromResult(result),
			usage: usageFromResult(result),
		};
	};
}

export function createStreamingOpenAIAgentsRunner(
	options: OpenAIAgentsRunnerOptions = {},
): StreamingAgentRunner {
	const runSdkStream = options.runSdkStream ?? defaultRunSdkStream;
	const maxTurns = options.maxTurns ?? 4;
	return async function* (input) {
		const requestOptions =
			options.resolveRuntimeOptions?.(input.providerConfig) ??
			({
				model: options.model,
				modelProvider: options.modelProvider,
			} satisfies Pick<OpenAIAgentsRunnerOptions, "model" | "modelProvider">);
		const sdkTools = input.tools.map((runtimeTool) =>
			tool({
				name: runtimeTool.name,
				description: runtimeTool.description,
				parameters: runtimeTool.parameters ?? emptyParametersSchema,
				strict: true,
				async execute(argumentsJson) {
					return runtimeTool.execute(recordFromToolArguments(argumentsJson));
				},
			}),
		);
		const agent = new Agent({
			name: "Campus primary assistant",
			instructions: input.instructions,
			model: requestOptions.model?.trim() || undefined,
			outputType: primaryAgentTerminalOutputSchema,
			tools: sdkTools,
		});
		const result = await runSdkStream(agent, input.input, {
			maxTurns,
			modelProvider: requestOptions.modelProvider,
			traceId: input.traceId,
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
			chunkIndex += 1;
			yield {
				accumulatedText: accumulatedVisibleText,
				chunkIndex,
				delta: visibleDelta,
			} satisfies AgentRunnerAnswerDelta;
		}
		await result.completed;
		const finalResult = agentRunnerResultFromSDKResult(result);
		if (accumulatedVisibleText !== "") {
			if (!finalResult.finalOutput.startsWith(accumulatedVisibleText)) {
				throw new Error("streamed answer text drifted from final output");
			}
			const tail = finalResult.finalOutput.slice(accumulatedVisibleText.length);
			if (tail !== "") {
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

function recordFromToolArguments(value: unknown): Record<string, unknown> {
	const record = recordFromUnknown(value);
	return record ?? {};
}

const defaultRunSdk: OpenAIAgentsRunFunction = async (agent, input, options) => {
	const runner = new Runner({
		modelProvider: options.modelProvider,
		traceId: options.traceId,
		workflowName: options.workflowName,
		traceIncludeSensitiveData: options.traceIncludeSensitiveData,
	});
	return runner.run(agent, input, {
		maxTurns: options.maxTurns,
		signal: options.signal,
	}) as Promise<OpenAIAgentsRunResultLike>;
};

const defaultRunSdkStream: OpenAIAgentsStreamRunFunction = async (agent, input, options) => {
	const runner = new Runner({
		modelProvider: options.modelProvider,
		traceId: options.traceId,
		workflowName: options.workflowName,
		traceIncludeSensitiveData: options.traceIncludeSensitiveData,
	});
	return runner.run(agent, input, {
		maxTurns: options.maxTurns,
		signal: options.signal,
		stream: true,
	}) as unknown as Promise<OpenAIAgentsStreamRunResultLike>;
};

function agentRunnerResultFromSDKResult(result: OpenAIAgentsRunResultLike) {
	const terminalEnvelope = terminalEnvelopeFromUnknown(result.finalOutput);
	return {
		finalOutput:
			terminalEnvelope === undefined
				? String(result.finalOutput ?? "")
				: finalOutputFromTerminalEnvelope(terminalEnvelope),
		providerResponseId: providerResponseIDFromResult(result),
		terminalEnvelope,
		toolCalls: toolCallsFromItems(result.newItems ?? []),
		traceRef: traceRefFromResult(result),
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
			return extractJsonStringFieldPrefix(value, ["answerText", "answer_text"]).value ?? "";
		case "clarification_required":
			return (
				extractJsonStringFieldPrefix(value, ["followUpQuestion", "follow_up_question"]).value ?? ""
			);
		case "out_of_scope":
		case "policy_refusal":
		case "unsupported_by_evidence":
			return extractJsonStringFieldPrefix(value, ["answerText", "answer_text"]).value ?? "";
		default:
			return "";
	}
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

function traceRefFromResult(result: OpenAIAgentsRunResultLike): string {
	const traceID = result.trace?.traceId ?? result.state?._trace?.traceId;
	return traceID === undefined || traceID.trim() === ""
		? ""
		: `trace://openai-agents/${traceID.trim()}`;
}

function usageFromResult(result: OpenAIAgentsRunResultLike) {
	const usage =
		result.usage ??
		result.state?.usage ??
		result.state?._context?.usage ??
		result.state?.context?.usage ??
		{};
	return {
		inputTokens: integerOrZero(usage.inputTokens),
		outputTokens: integerOrZero(usage.outputTokens),
		cachedInputTokens: cachedInputTokensFromUsage(usage),
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
	for (let index = 0; index < items.length; index++) {
		const item = recordFromUnknown(items[index]);
		if (item?.type !== "tool_call_item") {
			continue;
		}
		const rawItem = recordFromUnknown(item.rawItem);
		const name = stringFromUnknown(rawItem?.name);
		if (name === "") {
			continue;
		}
		const callID = stringFromUnknown(rawItem?.callId);
		calls.push({
			name,
			argumentsSummary: argumentsSummaryFromRawItem(rawItem),
			result: outputResultForCall(items, index, callID),
		});
	}
	return calls;
}

function outputResultForCall(
	items: unknown[],
	startIndex: number,
	callID: string,
): ToolExecutionResult | undefined {
	if (callID !== "") {
		for (const item of items) {
			const candidate = recordFromUnknown(item);
			if (candidate?.type !== "tool_call_output_item") {
				continue;
			}
			const rawItem = recordFromUnknown(candidate.rawItem);
			if (stringFromUnknown(rawItem?.callId) !== callID) {
				continue;
			}
			const result = toolResultFromOutput(rawItem);
			if (result !== undefined) {
				return result;
			}
		}
	}
	for (const item of items.slice(startIndex + 1)) {
		const candidate = recordFromUnknown(item);
		if (candidate?.type !== "tool_call_output_item") {
			continue;
		}
		const result = toolResultFromOutput(candidate.rawItem);
		if (result !== undefined) {
			return result;
		}
	}
	return;
}

function toolResultFromOutput(value: unknown): ToolExecutionResult | undefined {
	const rawItem = recordFromUnknown(value);
	const output = rawItem?.output;
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
	if (typeof textOutput?.text === "string") {
		try {
			const parsed = JSON.parse(textOutput.text);
			return isToolExecutionResult(parsed) ? parsed : undefined;
		} catch {
			return;
		}
	}
	return;
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
		typeof candidate.toolName === "string" &&
		typeof candidate.capability === "string" &&
		typeof candidate.payloadKind === "string" &&
		(candidate.argumentsJson === undefined ||
			recordFromUnknown(candidate.argumentsJson) !== undefined) &&
		recordFromUnknown(candidate.result) !== undefined &&
		typeof candidate.resultRef === "string"
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
