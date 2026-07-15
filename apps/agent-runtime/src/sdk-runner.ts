import {
	Agent,
	type AgentInputItem,
	type AgentOutputType,
	handoff,
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
	KnowledgeHandoff,
	KnowledgeTarget,
	PromptProviderRuntimeConfig,
	RunnerToolCall,
	StreamingAgentRunner,
	ToolExecutionResult,
} from "./primary-agent.ts";
import {
	finalOutputFromTerminalEnvelope,
	knowledgeTerminalEnvelopeFromUnknown,
	terminalEnvelopeFromUnknown,
} from "./primary-agent.ts";
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
	sessionUpdate: z
		.object({
			upsertSlots: z.array(
				z.object({
					confirmed: z.literal(true),
					name: z.enum(["curriculum_program", "curriculum_program_family", "curriculum_semester"]),
					value: z.string().min(1),
				}),
			),
		})
		.optional(),
});

const knowledgeSessionUpdateSchema = z
	.object({
		upsert_slots: z.array(
			z
				.object({
					confirmed: z.literal(true),
					name: z.enum(["curriculum_program", "curriculum_program_family", "curriculum_semester"]),
					value: z.string().min(1),
				})
				.strict(),
		),
	})
	.strict();

const uniqueEvidenceRefs = z
	.array(z.string().min(1))
	.refine((items) => new Set(items).size === items.length, "evidence_refs must be unique");

const knowledgeAgentTerminalOutputSchema = z
	.object({
		kind: z.enum(["answer", "clarification_required", "unsupported_by_evidence"]),
		answer_text: z.string().min(1).nullable(),
		follow_up_question: z.string().min(1).nullable(),
		reason: z.string().min(1).nullable(),
		evidence_refs: uniqueEvidenceRefs,
		session_update: knowledgeSessionUpdateSchema.nullable(),
	})
	.strict();

interface AgentSdkContext {
	runId: string;
	requestId: string;
	traceId: string;
	knowledgeTargets: KnowledgeTarget[];
	knowledge?: KnowledgeHandoff;
	searchBudget: {
		limit: number;
		reserved: number;
	};
	seenKnowledgeSearches: Set<string>;
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
			traceIncludeSensitiveData: true,
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
			traceIncludeSensitiveData: true,
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
			const nextVisibleText = visibleTextFromPartialTerminalOutput(
				rawOutputText,
				isKnowledgeAgent(result.currentAgent),
			);
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
			if (isKnowledgeAgent(result.currentAgent)) {
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
		const finalResult = agentRunnerResultFromSDKResult(result);
		if (accumulatedVisibleText !== "") {
			if (!finalResult.finalOutput.startsWith(accumulatedVisibleText)) {
				throw new Error("streamed answer text drifted from final output");
			}
			const tail = finalResult.finalOutput.slice(accumulatedVisibleText.length);
			if (tail.trim() !== "" && !isKnowledgeAgent(result.lastAgent ?? result.currentAgent)) {
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

function agentTraceMetadata(input: AgentRunnerInput): Record<string, string> {
	return {
		"campus.trace_id": input.traceId,
		"request.id": input.requestId,
		"run.id": input.runId,
	};
}

function isKnowledgeAgent(agent: { name?: string } | undefined): boolean {
	return agent?.name?.trim() === "Campus knowledge agent";
}

function createSdkRuntime(input: AgentRunnerInput, model: string | undefined) {
	const context: AgentSdkContext = {
		runId: input.runId,
		requestId: input.requestId,
		traceId: input.traceId,
		knowledgeTargets: input.knowledgeTargets ?? [],
		searchBudget: {
			limit: input.limits.maxKnowledgeSearches,
			reserved: 0,
		},
		seenKnowledgeSearches: new Set<string>(),
	};
	const sdkTools = input.tools.map((runtimeTool) => sdkTool(runtimeTool));
	const knowledgeAgentRuntime = input.knowledgeAgent;
	const knowledgeHandoff = (() => {
		if (knowledgeAgentRuntime === undefined) {
			return;
		}
		const knowledgeAgent = new Agent<AgentSdkContext, typeof knowledgeAgentTerminalOutputSchema>({
			name: "Campus knowledge agent",
			handoffDescription: knowledgeAgentRuntime.handoff.description,
			instructions: (runContext) =>
				knowledgeInstructions(
					knowledgeAgentRuntime.instructions,
					runContext.context.knowledge,
					runContext.context.knowledgeTargets,
				),
			model,
			modelSettings: { maxTokens: input.limits.maxOutputTokens },
			outputType: knowledgeAgentTerminalOutputSchema,
			tools: [sdkTool(knowledgeAgentRuntime.searchTool, { knowledgeSearch: true })],
		});
		return handoff(knowledgeAgent, {
			toolNameOverride: knowledgeAgentRuntime.handoff.name,
			toolDescriptionOverride: knowledgeAgentRuntime.handoff.description,
			inputType: knowledgeAgentRuntime.handoff.parameters,
			onHandoff(runContext, rawInput) {
				runContext.context.knowledge = knowledgeHandoffFromUnknown(rawInput);
			},
		});
	})();
	const toolChoice = input.toolChoice?.trim();
	if (toolChoice !== undefined && toolChoice !== "" && toolChoice !== "knowledge_query") {
		throw new Error(`unsupported primary agent tool choice: ${toolChoice}`);
	}
	if (toolChoice === "knowledge_query" && knowledgeHandoff === undefined) {
		throw new Error("knowledge_query tool choice requires the knowledge handoff");
	}
	const handoffs = knowledgeHandoff ? ([knowledgeHandoff] as const) : ([] as const);
	const agent = Agent.create({
		name: "Campus primary assistant",
		instructions: input.instructions,
		model,
		modelSettings: {
			maxTokens: input.limits.maxOutputTokens,
			...(toolChoice ? { toolChoice } : {}),
		},
		outputType: primaryAgentTerminalOutputSchema,
		// Agent.create in SDK 0.13.0 fixes handoff output inference but hard-codes unknown context.
		tools: sdkTools as unknown as Tool<unknown>[],
		handoffs,
	}) as Agent<
		AgentSdkContext,
		typeof primaryAgentTerminalOutputSchema | typeof knowledgeAgentTerminalOutputSchema
	>;
	return { agent, context };
}

function sdkTool(
	runtimeTool: AgentRunnerInput["tools"][number],
	options: { knowledgeSearch?: boolean } = {},
) {
	return tool<JsonObjectSchema, AgentSdkContext>({
		name: runtimeTool.name,
		description: runtimeTool.description,
		parameters: runtimeTool.parameters ?? emptyParametersSchema,
		strict: true,
		isEnabled: options.knowledgeSearch
			? ({ runContext }) =>
					runContext.context.searchBudget.reserved < runContext.context.searchBudget.limit
			: true,
		async execute(argumentsJson, runContext, details) {
			const parsedArguments = recordFromToolArguments(argumentsJson);
			if (options.knowledgeSearch) {
				const context = runContext?.context;
				if (context === undefined) {
					throw new Error("knowledge_search requires SDK run context");
				}
				const searchOrdinal = reserveKnowledgeSearch(context);
				if (searchOrdinal === undefined) {
					return searchBudgetExhaustedResult(runtimeTool.name, parsedArguments, context);
				}
				const searchKey = normalizedKnowledgeSearchKey(parsedArguments);
				if (context.seenKnowledgeSearches.has(searchKey)) {
					return duplicateKnowledgeSearchResult(runtimeTool.name, parsedArguments, context);
				}
				context.seenKnowledgeSearches.add(searchKey);
				return runtimeTool.execute(parsedArguments, {
					invocationId: details?.toolCall?.callId,
					searchOrdinal,
				});
			}
			return runtimeTool.execute(parsedArguments, {
				invocationId: details?.toolCall?.callId,
			});
		},
	});
}

function normalizedKnowledgeSearchKey(argumentsJson: Record<string, unknown>): string {
	const query = stringFromUnknown(argumentsJson.query_text)
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
	const target = stringFromUnknown(argumentsJson.target).trim();
	return `${target}\u0000${argumentsJson.include_history === true}\u0000${query}`;
}

function duplicateKnowledgeSearchResult(
	toolName: string,
	argumentsJson: Record<string, unknown>,
	context: AgentSdkContext,
): ToolExecutionResult {
	const target = stringFromUnknown(argumentsJson.target) || "unknown";
	return {
		status: "completed",
		toolName,
		payloadKind: toolName,
		argumentsJson,
		result: {
			outcome: "duplicate_query",
			search_ref: `agent-runtime://${context.runId}/knowledge/search/duplicate`,
			retrieval_target: target,
			include_history: argumentsJson.include_history === true,
			candidate_count: 0,
			discarded_count: 0,
			retriever_modes: [],
			evidence: [],
		},
		resultRef: `agent-runtime://${context.runId}/tools/${toolName}/duplicate-query`,
	};
}

function reserveKnowledgeSearch(context: AgentSdkContext): number | undefined {
	if (context.searchBudget.reserved >= context.searchBudget.limit) {
		return;
	}
	context.searchBudget.reserved += 1;
	return context.searchBudget.reserved;
}

function searchBudgetExhaustedResult(
	toolName: string,
	argumentsJson: Record<string, unknown>,
	context: AgentSdkContext,
): ToolExecutionResult {
	const target = stringFromUnknown(argumentsJson.target) || "unknown";
	return {
		status: "completed",
		toolName,
		payloadKind: toolName,
		argumentsJson,
		result: {
			outcome: "search_budget_exhausted",
			search_ref: `agent-runtime://${context.runId}/knowledge/search/budget`,
			retrieval_target: target,
			include_history: argumentsJson.include_history === true,
			candidate_count: 0,
			discarded_count: 0,
			retriever_modes: [],
			evidence: [],
		},
		resultRef: `agent-runtime://${context.runId}/tools/${toolName}/budget-exhausted`,
	};
}

function knowledgeHandoffFromUnknown(value: unknown): KnowledgeHandoff {
	const record = recordFromUnknown(value);
	const queryText = stringFromUnknown(record?.query_text);
	if (queryText === "") {
		throw new Error("knowledge_query requires query_text");
	}
	return { queryText };
}

function knowledgeInstructions(
	base: string,
	selection: KnowledgeHandoff | undefined,
	targets: KnowledgeTarget[],
): string {
	if (selection === undefined) {
		throw new Error("knowledge agent requires an admitted handoff context");
	}
	if (targets.length === 0) {
		throw new Error("knowledge agent requires query-serving targets");
	}
	const lines = [
		base,
		"<knowledge_targets>",
		"Use only these target ids when calling knowledge_search:",
	];
	for (const target of targets) {
		lines.push(`- ${target.target}: ${target.description}`);
	}
	lines.push("</knowledge_targets>");
	return lines.join("\n");
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
	const terminalEnvelope = isKnowledgeAgent(result.lastAgent ?? result.currentAgent)
		? knowledgeTerminalEnvelopeFromUnknown(result.finalOutput)
		: terminalEnvelopeFromUnknown(result.finalOutput);
	const toolCalls = toolCallsFromItems(result.newItems ?? []);
	return {
		finalOutput:
			terminalEnvelope === undefined
				? String(result.finalOutput ?? "")
				: finalOutputFromTerminalEnvelope(terminalEnvelope),
		providerResponseId: providerResponseIDFromResult(result),
		terminalEnvelope,
		toolCalls: toolCalls.publicCalls,
		internalToolCalls: toolCalls.internalCalls,
		usage: usageFromResult(result),
	};
}

function visibleTextFromPartialTerminalOutput(value: string, knowledgeAgent: boolean): string {
	try {
		const envelope = knowledgeAgent
			? knowledgeTerminalEnvelopeFromUnknown(JSON.parse(value))
			: terminalEnvelopeFromUnknown(JSON.parse(value));
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
			return trimStringValue(
				extractJsonStringFieldPrefix(value, [knowledgeAgent ? "answer_text" : "answerText"]).value,
			);
		case "clarification_required":
			return trimStringValue(
				extractJsonStringFieldPrefix(value, [
					knowledgeAgent ? "follow_up_question" : "followUpQuestion",
				]).value,
			);
		case "out_of_scope":
		case "policy_refusal":
		case "unsupported_by_evidence":
			return trimStringValue(
				extractJsonStringFieldPrefix(value, [knowledgeAgent ? "answer_text" : "answerText"]).value,
			);
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

function toolCallsFromItems(items: unknown[]): {
	publicCalls: RunnerToolCall[];
	internalCalls: RunnerToolCall[];
} {
	const publicCalls: RunnerToolCall[] = [];
	const internalCalls: RunnerToolCall[] = [];
	let knowledgeHandoffRecorded = false;
	for (let index = 0; index < items.length; index++) {
		const item = recordFromUnknown(items[index]);
		if (item?.type === "handoff_call_item") {
			const rawItem = recordFromUnknown(item.rawItem);
			const name = stringFromUnknown(rawItem?.name);
			if (name === "knowledge_query" && !knowledgeHandoffRecorded) {
				publicCalls.push({
					name,
					argumentsSummary: argumentsSummaryFromRawItem(rawItem),
					result: undefined,
				});
				knowledgeHandoffRecorded = true;
			}
			continue;
		}
		if (item?.type !== "tool_call_item") {
			continue;
		}
		const rawItem = recordFromUnknown(item.rawItem);
		const name = stringFromUnknown(rawItem?.name);
		if (name === "") {
			continue;
		}
		const callID = stringFromUnknown(rawItem?.callId);
		const call = {
			name,
			argumentsSummary: argumentsSummaryFromRawItem(rawItem),
			result: outputResultForCall(items, index, callID),
		};
		if (name === "knowledge_search") {
			internalCalls.push(call);
		} else {
			publicCalls.push(call);
		}
	}
	return { publicCalls, internalCalls };
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
