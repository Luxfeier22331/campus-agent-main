import { PANEL_COPY } from "../panel-copy";
import type { RequestWorkflowTraceSummary } from "../types";

const FORBIDDEN_WORKFLOW_TRACE_KEY_TOKENS = [
	"auth_envelope",
	"cookie",
	"jwt",
	"provider_raw_response",
	"raw_bridge_payload",
	"raw_payload",
	"raw_prompt",
	"raw_response",
	"raw_transcript",
	"retrieval_backend_dump",
];

function formatKeyValueRecord(record: Record<string, unknown> | null | undefined) {
	if (!record || Object.keys(record).length === 0) {
		return PANEL_COPY.none;
	}
	const entries = Object.entries(record)
		.filter(
			([key, value]) =>
				!isForbiddenWorkflowTraceKey(key) &&
				(typeof value === "string" || typeof value === "number"),
		)
		.sort(([left], [right]) => left.localeCompare(right));
	return entries.length > 0
		? entries.map(([key, value]) => `${key}=${value}`).join(" · ")
		: PANEL_COPY.none;
}

function isForbiddenWorkflowTraceKey(key: string) {
	const normalized = normalizeWorkflowTraceKeyToken(key);
	return FORBIDDEN_WORKFLOW_TRACE_KEY_TOKENS.some((token) =>
		normalized.includes(normalizeWorkflowTraceKeyToken(token)),
	);
}

function normalizeWorkflowTraceKeyToken(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

function workflowStringValue(record: Record<string, unknown>, ...keys: string[]) {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) {
			return value;
		}
	}
	return null;
}

function workflowStringArray(record: Record<string, unknown>, ...keys: string[]) {
	for (const key of keys) {
		const value = record[key];
		if (Array.isArray(value)) {
			return value.filter(
				(item): item is string => typeof item === "string" && item.trim().length > 0,
			);
		}
	}
	return [];
}

function workflowRecordValue(
	record: Record<string, unknown> | null | undefined,
	...keys: string[]
) {
	if (!record) {
		return null;
	}
	for (const key of keys) {
		const value = record[key];
		if (value && typeof value === "object" && !Array.isArray(value)) {
			return value as Record<string, unknown>;
		}
	}
	return null;
}

function workflowNumberValue(record: Record<string, unknown>, ...keys: string[]) {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
	}
	return null;
}

function formatWorkflowToolCalls(toolCalls: Record<string, unknown>[] | null | undefined) {
	if (!toolCalls || toolCalls.length === 0) {
		return PANEL_COPY.none;
	}
	return toolCalls
		.map((toolCall) => {
			const toolName = workflowStringValue(toolCall, "tool_name", "tool") ?? PANEL_COPY.unknown;
			const resultStatus =
				workflowStringValue(toolCall, "result_status", "status") ?? PANEL_COPY.unknown;
			const businessOutcome = workflowStringValue(
				toolCall,
				"business_outcome",
				"businessOutcome",
				"outcome",
			);
			return businessOutcome
				? `${toolName}:${resultStatus}/${businessOutcome}`
				: `${toolName}:${resultStatus}`;
		})
		.join(" · ");
}

function workflowSafeDetailRecords(trace: RequestWorkflowTraceSummary) {
	const records: Record<string, unknown>[] = [];
	const summarySafeDetails = workflowRecordValue(
		trace.toolArgumentSummary,
		"safe_details",
		"safeDetails",
	);
	if (summarySafeDetails) {
		records.push(summarySafeDetails);
	}
	for (const toolCall of trace.toolCallSummaries ?? []) {
		const toolSafeDetails = workflowRecordValue(toolCall, "safe_details", "safeDetails");
		if (toolSafeDetails) {
			records.push(toolSafeDetails);
		}
	}
	return records;
}

function formatWorkflowExecutionProjections(trace: RequestWorkflowTraceSummary) {
	const values: string[] = [];
	const seen = new Set<string>();
	for (const safeDetails of workflowSafeDetailRecords(trace)) {
		const projection = workflowRecordValue(
			safeDetails,
			"agent_execution_projection",
			"agentExecutionProjection",
		);
		if (!projection) {
			continue;
		}
		const selectedTool =
			workflowStringValue(projection, "selected_tool", "selectedTool") ?? PANEL_COPY.unknown;
		const owner =
			workflowStringValue(projection, "projection_owner", "projectionOwner") ?? PANEL_COPY.unknown;
		const reason =
			workflowStringValue(projection, "tool_selection_reason", "toolSelectionReason") ??
			PANEL_COPY.unknown;
		const value = `${selectedTool}:${owner}/${reason}`;
		if (!seen.has(value)) {
			values.push(value);
			seen.add(value);
		}
	}
	return values.length > 0 ? values.join(" · ") : PANEL_COPY.none;
}

function formatWorkflowResultGuardrails(trace: RequestWorkflowTraceSummary) {
	const values: string[] = [];
	const seen = new Set<string>();
	for (const safeDetails of workflowSafeDetailRecords(trace)) {
		const resultGuardrail = workflowRecordValue(safeDetails, "result_guardrail", "resultGuardrail");
		if (!resultGuardrail) {
			continue;
		}
		const outcome = workflowStringValue(resultGuardrail, "outcome", "status") ?? PANEL_COPY.unknown;
		const sourceRefCount =
			workflowNumberValue(resultGuardrail, "source_ref_count", "sourceRefCount") ?? 0;
		const accessDecision =
			workflowStringValue(resultGuardrail, "access_decision", "accessDecision") ??
			PANEL_COPY.unknown;
		const failureClass = workflowStringValue(resultGuardrail, "failure_class", "failureClass");
		const value = failureClass
			? `${outcome}/source_refs=${sourceRefCount}/access=${accessDecision}/failure=${failureClass}`
			: `${outcome}/source_refs=${sourceRefCount}/access=${accessDecision}`;
		if (!seen.has(value)) {
			values.push(value);
			seen.add(value);
		}
	}
	return values.length > 0 ? values.join(" · ") : PANEL_COPY.none;
}

function formatWorkflowSourceIds(toolCalls: Record<string, unknown>[] | null | undefined) {
	const sourceIds = new Set<string>();
	for (const toolCall of toolCalls ?? []) {
		for (const sourceId of workflowStringArray(
			toolCall,
			"source_ids",
			"sourceIds",
			"evidence_ids",
			"evidenceIds",
		)) {
			sourceIds.add(sourceId);
		}
		const singleSourceId = workflowStringValue(toolCall, "source_id", "sourceId");
		if (singleSourceId) {
			sourceIds.add(singleSourceId);
		}
	}
	return sourceIds.size > 0 ? Array.from(sourceIds).join(", ") : PANEL_COPY.none;
}

function formatWorkflowFailCloseProvenance(trace: RequestWorkflowTraceSummary) {
	const values: string[] = [];
	if (trace.failCloseReason) {
		values.push(`summary:${trace.failCloseReason}`);
	}
	for (const toolCall of trace.toolCallSummaries ?? []) {
		const toolName = workflowStringValue(toolCall, "tool_name", "tool");
		const reason = workflowStringValue(toolCall, "fail_close_reason", "failCloseReason");
		if (toolName && reason) {
			values.push(`${toolName}:${reason}`);
		}
	}
	return values.length > 0 ? values.join(" · ") : PANEL_COPY.none;
}

function formatWorkflowTraceSteps(steps: Record<string, unknown>[] | null | undefined) {
	if (!steps || steps.length === 0) {
		return PANEL_COPY.none;
	}
	return steps
		.map((step) => {
			const stepId = workflowStringValue(step, "step_id", "stepId") ?? PANEL_COPY.unknown;
			const spanKind = workflowStringValue(step, "span_kind", "spanKind");
			const outcome = workflowStringValue(step, "outcome", "status") ?? PANEL_COPY.unknown;
			return spanKind ? `${stepId}(${spanKind}):${outcome}` : `${stepId}:${outcome}`;
		})
		.join(" · ");
}

export function buildRequestWorkflowTraceEntries(
	trace: RequestWorkflowTraceSummary | undefined | null,
) {
	if (!trace) {
		return [];
	}
	return [
		{
			label: "工具序列",
			value: trace.selectedTools.length > 0 ? trace.selectedTools.join(", ") : PANEL_COPY.none,
		},
		{
			label: "工具调用",
			value: formatWorkflowToolCalls(trace.toolCallSummaries),
		},
		{
			label: "执行状态",
			value: formatWorkflowExecutionProjections(trace),
		},
		{
			label: "结果护栏",
			value: formatWorkflowResultGuardrails(trace),
		},
		{
			label: "来源证据",
			value: formatWorkflowSourceIds(trace.toolCallSummaries),
		},
		{
			label: "Fail Close 来源",
			value: formatWorkflowFailCloseProvenance(trace),
		},
		{
			label: "Trace 步骤",
			value: formatWorkflowTraceSteps(trace.traceSteps),
		},
		{
			label: "Runtime 版本",
			value: formatKeyValueRecord(trace.runtimeVersions),
		},
		{
			label: "Policy 版本",
			value: formatKeyValueRecord(trace.policyArtifactVersions),
		},
	];
}
