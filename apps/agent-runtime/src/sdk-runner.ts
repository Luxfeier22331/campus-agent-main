import { Agent, Runner, tool } from "@openai/agents";
import type { AgentRunner, RunnerToolCall, ToolExecutionResult } from "./primary-agent.ts";

const emptyParametersSchema = {
	type: "object" as const,
	additionalProperties: false as const,
	properties: {},
	required: [],
};

export interface OpenAIAgentsRunnerOptions {
	runSdk?: OpenAIAgentsRunFunction;
	maxTurns?: number;
}

export type OpenAIAgentsRunFunction = (
	agent: Agent,
	input: string,
	options: {
		maxTurns: number;
		traceId: string;
		workflowName: string;
		traceIncludeSensitiveData: boolean;
	},
) => Promise<OpenAIAgentsRunResultLike>;

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
			tools: sdkTools,
		});
		const result = await runSdk(agent, input.input, {
			maxTurns,
			traceId: input.traceId,
			workflowName: "campus-agent.primary-agent",
			traceIncludeSensitiveData: false,
		});
		return {
			finalOutput: String(result.finalOutput ?? ""),
			providerResponseId: providerResponseIDFromResult(result),
			toolCalls: toolCallsFromItems(result.newItems ?? []),
			traceRef: traceRefFromResult(result),
			usage: usageFromResult(result),
		};
	};
}

function recordFromToolArguments(value: unknown): Record<string, unknown> {
	const record = recordFromUnknown(value);
	return record ?? {};
}

const defaultRunSdk: OpenAIAgentsRunFunction = async (agent, input, options) => {
	const runner = new Runner({
		traceId: options.traceId,
		workflowName: options.workflowName,
		traceIncludeSensitiveData: options.traceIncludeSensitiveData,
	});
	return runner.run(agent, input, {
		maxTurns: options.maxTurns,
	}) as Promise<OpenAIAgentsRunResultLike>;
};

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
