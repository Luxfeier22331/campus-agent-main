import type { JsonObjectSchema, ToolCatalog, ToolCatalogEntry } from "./tool-catalog.ts";
import { buildVisibleToolDefinitions } from "./tool-catalog.ts";

export interface PrimaryAgentRunInput {
	runId: string;
	conversationId: string;
	turnId: string;
	traceId: string;
	input: string;
	visibleCapabilities: string[];
	memoryProjectionRefs?: string[];
}

export interface UsageSummary {
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens?: number;
	estimatedCostMicroUsd?: number;
}

export interface ToolExecutionRequest {
	tool: ToolCatalogEntry;
	argumentsJson: Record<string, unknown>;
	runId: string;
	traceId: string;
}

export interface ToolExecutionResult {
	status: "completed" | "failed";
	toolName: string;
	capability: string;
	payloadKind: string;
	result: Record<string, unknown>;
	resultRef: string;
	failCloseReason?: string;
}

export interface SdkToolRuntime {
	name: string;
	description: string;
	parameters?: JsonObjectSchema;
	execute(argumentsJson: Record<string, unknown>): Promise<ToolExecutionResult>;
}

export interface RunnerToolCall {
	name: string;
	argumentsSummary: Record<string, unknown>;
	result: ToolExecutionResult | undefined;
}

export interface AgentRunnerInput {
	input: string;
	instructions: string;
	tools: SdkToolRuntime[];
	runId: string;
	traceId: string;
}

export interface AgentRunnerResult {
	finalOutput: string;
	providerResponseId: string;
	toolCalls: RunnerToolCall[];
	traceRef: string;
	usage: UsageSummary;
}

export type AgentRunner = (input: AgentRunnerInput) => Promise<AgentRunnerResult>;
export type ToolExecutor = (request: ToolExecutionRequest) => Promise<ToolExecutionResult>;

export interface PrimaryAgentRunResult {
	status: "completed" | "failed";
	runId: string;
	finalOutput: string;
	providerResponseId: string;
	sdkTraceRef: string;
	selectedTools: string[];
	toolResults: ToolExecutionResult[];
	terminalReason: "answer_completed" | "agent_runtime_failed" | "tool_selected";
	usage: UsageSummary;
}

export interface PrimaryAgentRuntime {
	run(input: PrimaryAgentRunInput): Promise<PrimaryAgentRunResult>;
}

export interface CreatePrimaryAgentRuntimeOptions {
	catalog: ToolCatalog;
	runner: AgentRunner;
	toolExecutor?: ToolExecutor;
	instructions?: string;
}

const defaultInstructions = [
	"You are the campus-agent primary assistant.",
	"Answer directly when no campus tool is needed.",
	"Use the available tools only when they are necessary for current campus facts.",
	"Do not invent campus facts when tools return no answer.",
].join("\n");

export function createPrimaryAgentRuntime(
	options: CreatePrimaryAgentRuntimeOptions,
): PrimaryAgentRuntime {
	const instructions = options.instructions?.trim() || defaultInstructions;
	const executor = options.toolExecutor ?? defaultToolExecutor;
	return {
		async run(input) {
			const visibleTools = buildVisibleToolDefinitions(options.catalog)
				.filter((tool) => input.visibleCapabilities.includes(tool.capability))
				.map((tool): SdkToolRuntime => {
					const catalogEntry = requireCatalogEntry(options.catalog, tool.name);
					return {
						name: tool.name,
						description: tool.description,
						parameters: tool.parameterSchema,
						execute(argumentsJson) {
							const request: ToolExecutionRequest = {
								tool: catalogEntry,
								argumentsJson,
								runId: input.runId,
								traceId: input.traceId,
							};
							if (catalogEntry.handler.type === "workflow_signal") {
								return defaultToolExecutor(request);
							}
							return executor(request);
						},
					};
				});
			const result = await options.runner({
				input: input.input,
				instructions,
				tools: visibleTools,
				runId: input.runId,
				traceId: input.traceId,
			});
			const toolResults = result.toolCalls
				.map((call) => call.result)
				.filter((value): value is ToolExecutionResult => value !== undefined);
			const failedToolResult = toolResults.find((toolResult) => toolResult.status === "failed");
			if (failedToolResult !== undefined) {
				return {
					status: "failed",
					runId: input.runId,
					finalOutput: "",
					providerResponseId: result.providerResponseId,
					sdkTraceRef: result.traceRef,
					selectedTools: result.toolCalls.map((call) => call.name),
					toolResults,
					terminalReason: "agent_runtime_failed",
					usage: result.usage,
				};
			}
			const terminalReason = toolResults.some(
				(toolResult) => toolResult.result.workflow_signal === toolResult.toolName,
			)
				? "tool_selected"
				: "answer_completed";
			return {
				status: "completed",
				runId: input.runId,
				finalOutput: result.finalOutput,
				providerResponseId: result.providerResponseId,
				sdkTraceRef: result.traceRef,
				selectedTools: result.toolCalls.map((call) => call.name),
				toolResults,
				terminalReason,
				usage: result.usage,
			};
		},
	};
}

function requireCatalogEntry(catalog: ToolCatalog, name: string): ToolCatalogEntry {
	const tool = catalog.tools.find((candidate) => candidate.name === name);
	if (tool === undefined) {
		throw new Error(`tool ${name} missing from catalog`);
	}
	return tool;
}

async function defaultToolExecutor(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
	if (request.tool.handler.type === "workflow_signal") {
		return {
			status: "completed",
			toolName: request.tool.name,
			capability: request.tool.capability,
			payloadKind: request.tool.name,
			result: {
				workflow_signal: request.tool.name,
			},
			resultRef: `agent-runtime://${request.runId}/tools/${request.tool.name}`,
		};
	}
	return {
		status: "failed",
		toolName: request.tool.name,
		capability: request.tool.capability,
		payloadKind: request.tool.name,
		result: {
			error: "tool executor is not configured",
		},
		resultRef: `agent-runtime://${request.runId}/tools/${request.tool.name}/failed`,
		failCloseReason: "tool_executor_not_configured",
	};
}
