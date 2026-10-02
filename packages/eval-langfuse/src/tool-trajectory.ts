import { type JsonObject, mappingList, optionalString, stringField } from "./json";

export const AGENT_RUNTIME_TOOL_NAMES = ["campus_search", "personal_memory_recall"] as const;

export type AgentRuntimeToolName = (typeof AGENT_RUNTIME_TOOL_NAMES)[number];
export type ToolDecisionKind = "direct_answer" | "fail_closed" | "tool_assisted";

export interface ToolTrajectoryCall {
	search_goal?: string;
	search_query?: string;
	tool_name: AgentRuntimeToolName;
}

export interface ToolTrajectory {
	decision_kind: ToolDecisionKind;
	schema_version: "tool_trajectory.v4";
	tool_calls: ToolTrajectoryCall[];
}

const agentRuntimeToolNames = new Set<string>(AGENT_RUNTIME_TOOL_NAMES);

export function parseToolTrajectory(value: unknown): ToolTrajectory {
	const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
	const schemaVersion = stringField(
		(input as JsonObject).schema_version,
		"tool_trajectory.schema_version",
	);
	if (schemaVersion !== "tool_trajectory.v4") {
		throw new Error(`tool_trajectory schema_version ${schemaVersion} is not supported`);
	}
	const decisionKind = parseDecisionKind((input as JsonObject).decision_kind);
	const toolCalls = parseToolCalls((input as JsonObject).tool_calls);
	if (decisionKind === "direct_answer" && toolCalls.length > 0) {
		throw new Error("direct_answer trajectory must not contain tool calls");
	}
	if (decisionKind === "tool_assisted" && toolCalls.length === 0) {
		throw new Error("tool_assisted trajectory must contain at least one tool call");
	}
	return {
		decision_kind: decisionKind,
		schema_version: "tool_trajectory.v4",
		tool_calls: toolCalls,
	};
}

export function toolSequenceFromTrajectory(trajectory: ToolTrajectory): AgentRuntimeToolName[] {
	return trajectory.tool_calls.map((call) => call.tool_name);
}

export function scoreToolSequence(
	trajectory: ToolTrajectory,
	expectedTools: readonly AgentRuntimeToolName[],
): boolean {
	const observed = toolSequenceFromTrajectory(trajectory);
	return (
		observed.length === expectedTools.length &&
		observed.every((toolName, index) => toolName === expectedTools[index])
	);
}

export function parseAgentRuntimeToolName(value: unknown, field: string): AgentRuntimeToolName {
	const toolName = stringField(value, field);
	if (!agentRuntimeToolNames.has(toolName)) {
		throw new Error(`${field} ${toolName} is not an active agent runtime tool`);
	}
	return toolName as AgentRuntimeToolName;
}

function parseDecisionKind(value: unknown): ToolDecisionKind {
	const raw = stringField(value, "tool_trajectory.decision_kind");
	if (raw === "direct_answer" || raw === "fail_closed" || raw === "tool_assisted") {
		return raw;
	}
	throw new Error(`tool_trajectory decision_kind ${raw} is not supported`);
}

function parseToolCalls(value: unknown): ToolTrajectoryCall[] {
	return mappingList(value ?? [], "tool_trajectory.tool_calls").map((call, index) => {
		const searchQuery = optionalString(call.search_query);
		const searchGoal = optionalString(call.search_goal);
		return {
			...(searchGoal ? { search_goal: searchGoal } : {}),
			...(searchQuery ? { search_query: searchQuery } : {}),
			tool_name: parseAgentRuntimeToolName(
				call.tool_name,
				`tool_trajectory.tool_calls[${index}].tool_name`,
			),
		};
	});
}
