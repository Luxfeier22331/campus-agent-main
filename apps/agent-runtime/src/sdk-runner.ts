import {
	Agent,
	type ModelProvider,
	Runner,
	type RunResult,
	type StreamedRunResult,
	tool,
	type Usage,
} from "@openai/agents";
import type {
	AgentRunner,
	AgentRunnerAnswerDelta,
	AgentRunnerInput,
	PromptProviderRuntimeConfig,
	SdkToolRuntime,
	StreamingAgentRunner,
	ToolExecutionResult,
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
	toolBudget: {
		limit: number;
		reserved: number;
	};
	toolResults: Map<string, ToolExecutionResult>;
}

// Agents SDK uses this broad bound for its invariant result type parameter.
// biome-ignore lint/suspicious/noExplicitAny: required by the Agents SDK result type constraint
type CampusAgent = Agent<AgentSdkContext, any>;

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
		const runner = createSdkRunner(requestOptions.modelProvider);
		const result = await runner.run(runtime.agent, input.input, {
			context: runtime.context,
			maxTurns: input.limits.maxTurns,
			...(input.signal ? { signal: input.signal } : {}),
		});
		return agentRunnerResultFromSDKResult(result);
	};
}

export function createStreamingOpenAIAgentsRunner(
	options: OpenAIAgentsRunnerOptions = {},
): StreamingAgentRunner {
	return async function* (input) {
		const requestOptions = resolveRequestOptions(options, input.providerConfig);
		const runtime = createSdkRuntime(input, requestOptions.model?.trim() || undefined);
		const runner = createSdkRunner(requestOptions.modelProvider);
		const result = await runner.run(runtime.agent, input.input, {
			context: runtime.context,
			maxTurns: input.limits.maxTurns,
			...(input.signal ? { signal: input.signal } : {}),
			stream: true,
		});
		for await (const delta of result.toTextStream()) {
			if (delta !== "") {
				yield { delta } satisfies AgentRunnerAnswerDelta;
			}
		}
		await result.completed;
		throwIfStreamRunDidNotComplete(result, input.signal);
		yield agentRunnerResultFromSDKResult(result);
	};
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

function createSdkRunner(modelProvider: ModelProvider | undefined): Runner {
	return new Runner({
		...(modelProvider ? { modelProvider } : {}),
		workflowName: "campus-agent.primary-agent",
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
		campusSearch: { nextCitationIndex: 1, queue: Promise.resolve() },
		toolBudget: {
			limit: input.limits.maxToolCalls,
			reserved: 0,
		},
		toolResults: new Map(),
	};
	const agent = new Agent<AgentSdkContext>({
		name: "Campus primary assistant",
		instructions: input.instructions,
		...(model ? { model } : {}),
		modelSettings: { maxTokens: input.limits.maxOutputTokens },
		tools: input.tools.map((runtimeTool) => sdkTool(runtimeTool)),
	});
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
			if (context.toolBudget.reserved >= context.toolBudget.limit) {
				throw new AgentRuntimeError(
					"tool_execution_failed",
					"The admitted tool call budget is exhausted.",
				);
			}
			const invocationId = details?.toolCall?.callId;
			if (!invocationId) {
				throw new AgentRuntimeError(
					"tool_execution_failed",
					`${runtimeTool.name} is missing its SDK call ID.`,
				);
			}
			context.toolBudget.reserved += 1;
			const startedAt = performance.now();
			const parsedArguments = argumentsJson as Record<string, unknown>;
			const result = await executeSdkTool(runtimeTool, parsedArguments, context, invocationId);
			context.toolResults.set(invocationId, {
				...result,
				argumentsJson: parsedArguments,
				durationMs: Math.max(0.001, performance.now() - startedAt),
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
) {
	return {
		finalOutput: result.finalOutput ?? "",
		providerResponseId: result.lastResponseId?.trim() ?? "",
		toolResults: toolResultsFromSDKResult(result),
		usage: usageFromSDK(result.runContext.usage),
	};
}

function toolResultsFromSDKResult(
	result: RunResult<AgentSdkContext, CampusAgent> | StreamedRunResult<AgentSdkContext, CampusAgent>,
): ToolExecutionResult[] {
	const tracked = result.runContext.context.toolResults;
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
