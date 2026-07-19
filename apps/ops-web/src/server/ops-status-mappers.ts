import { createHmac } from "node:crypto";
import type {
	OpsRequestDetailResponse,
	OpsRequestListResponse,
	OpsRequestSummary,
} from "../shared/ops-contract";
import { projectOpsStageTiming, projectOpsStageTimingBudget } from "../shared/stage-timing.ts";
import {
	type OpsObservabilityLinkAllowlist,
	toSentryExternalLink,
	toTemporalExternalLink,
} from "./ops-external-links.ts";
import type {
	OpsRequestListQuery,
	OpsRequestObservabilityRow,
	OpsRequestRow,
	OpsRequestSummaryTotals,
} from "./ops-status-store.ts";

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const TEST_PRINCIPAL_HASH_SECRET = "ops-web-test-principal-hash-secret";

export function toRequestDetail(
	requestRow: OpsRequestRow,
	observabilityRow: OpsRequestObservabilityRow | null,
	observabilityLinks?: OpsObservabilityLinkAllowlist,
	principalHashSecret: string = TEST_PRINCIPAL_HASH_SECRET,
): OpsRequestDetailResponse {
	const request = toRequestSummary(requestRow, observabilityRow, principalHashSecret);
	const workflowTrace = normalizeWorkflowTrace(observabilityRow?.workflowTraceSummaryJson);
	const workflowId = toTemporalWorkflowId(request.runId);
	const externalLinks = normalizeExternalLinks(observabilityLinks, workflowId);

	return {
		correlationIds: {
			conversationId: request.conversationId,
			missingCorrelationFields: missingCorrelationFields({
				runId: request.runId,
				workflowId,
			}),
			requestId: request.requestId,
			runId: request.runId,
			traceId: request.traceId,
			workflowId,
		},
		externalLinks,
		modelSummary: {
			model: normalizeNullableString(observabilityRow?.modelName),
			promptId: normalizeNullableString(observabilityRow?.promptId),
			provider: normalizeNullableString(observabilityRow?.modelProvider),
			promptVersion: normalizeNullableString(observabilityRow?.promptVersion),
			templateSha256: normalizeNullableString(observabilityRow?.templateSha256),
		},
		outcomeSummary: {
			refusalClass: normalizeNullableString(observabilityRow?.refusalClass),
			resolvedTargets: normalizeStringArray(observabilityRow?.resolvedTargetsJson),
			semanticOutcome: normalizeNullableString(observabilityRow?.semanticOutcome),
		},
		policySummary: {
			aclAnomalyCode: normalizeNullableString(observabilityRow?.aclAnomalyCode),
			aclDecision: normalizeNullableString(observabilityRow?.aclDecision),
			failClosed: observabilityRow?.failClosed ?? null,
		},
		request,
		sources: normalizeSupportingSources(observabilityRow?.supportingSourcesJson),
		stageTiming: projectOpsStageTiming(observabilityRow?.stageTimingJson),
		stageTimingBudget: projectOpsStageTimingBudget(observabilityRow?.stageTimingJson),
		stepTrajectory: workflowTrace.steps,
		toolSummary: {
			requestedTool: request.requestedTool,
			selectedTool: request.selectedTool,
		},
		traceSummary: {
			available: observabilityRow?.traceAvailable ?? false,
			measuredAt: normalizeIsoString(observabilityRow?.measuredAt),
			projectionLagMs: normalizeNullableNonNegativeInteger(observabilityRow?.projectionLagMs),
			updatedAt: normalizeIsoString(observabilityRow?.updatedAt),
		},
		workflowSummary: {
			branch: workflowTrace.branch,
			firstDecisionActor: workflowTrace.firstDecisionActor,
			mode: workflowTrace.mode,
			planningOutcome: workflowTrace.planningOutcome,
			runtimeVersions: workflowTrace.runtimeVersions,
			selectedTools: workflowTrace.selectedTools,
			terminalReason: workflowTrace.terminalReason,
		},
	};
}

export function toRequestSummary(
	row: OpsRequestRow,
	observability: OpsRequestObservabilityRow | null,
	principalHashSecret: string = TEST_PRINCIPAL_HASH_SECRET,
): OpsRequestSummary {
	const status = normalizeRequestStatus(row.status);
	const runId = normalizeNullableString(row.runId);
	const workflowId = toTemporalWorkflowId(runId);
	return {
		completedAt: row.completedAt?.toISOString() ?? null,
		conversationId: row.conversationId,
		diagnostics: summarizeRequestDiagnostics(row, observability),
		durationMs: row.durationMs ?? null,
		errorCode: row.errorCode ?? null,
		principalHash: hashPrincipal(row.principalId, row.principalType, principalHashSecret),
		principalType: normalizeNonEmptyString(row.principalType, "unknown"),
		projectedAt: row.projectedAt.toISOString(),
		questionPreview: row.questionPreview,
		requestId: row.requestId,
		requestedTool: row.requestedTool ?? null,
		runId,
		selectedTool: row.selectedTool ?? null,
		startedAt: row.startedAt.toISOString(),
		status,
		traceId: row.traceId,
		workflowId,
	};
}

function hashPrincipal(
	principalId: string | null | undefined,
	principalType: string,
	secret: string,
) {
	const normalizedType = normalizeNonEmptyString(principalType, "unknown");
	const normalizedPrincipalId = normalizeNullableString(principalId);
	if (!normalizedPrincipalId) {
		return `principal:v1:${normalizedType}:unknown`;
	}
	const digest = createHmac("sha256", secret)
		.update(`${normalizedType}:${normalizedPrincipalId}`, "utf8")
		.digest("hex")
		.slice(0, 16);
	return `principal:v1:${normalizedType}:${digest}`;
}

export function matchesRequestQuery(request: OpsRequestSummary, query: OpsRequestListQuery) {
	if (query.status && request.status !== query.status) {
		return false;
	}
	if (query.conversationId && request.conversationId !== query.conversationId) {
		return false;
	}
	if (query.requestId && request.requestId !== query.requestId) {
		return false;
	}
	if (query.traceId && request.traceId !== query.traceId) {
		return false;
	}
	if (query.q && !requestSearchText(request).includes(query.q.toLowerCase())) {
		return false;
	}
	return true;
}

export interface RequestKeysetCursor {
	requestId: string;
	startedAt: string;
}

export function encodeRequestCursor(row: { requestId: string; startedAt: Date | string }) {
	const startedAt = row.startedAt instanceof Date ? row.startedAt.toISOString() : row.startedAt;
	return Buffer.from(JSON.stringify({ requestId: row.requestId, startedAt }), "utf8").toString(
		"base64url",
	);
}

export function decodeRequestCursor(cursor: string | undefined): RequestKeysetCursor | null {
	if (!cursor) {
		return null;
	}
	try {
		const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
		if (!isRecord(parsed)) {
			return null;
		}
		const requestId = normalizeNullableString(parsed.requestId);
		const startedAt = normalizeNullableString(parsed.startedAt);
		if (!(requestId && startedAt && Number.isFinite(Date.parse(startedAt)))) {
			return null;
		}
		return { requestId, startedAt };
	} catch {
		return null;
	}
}

export function summarizeRequests(
	requests: OpsRequestSummary[],
): OpsRequestListResponse["summary"] {
	return {
		cancelled: requests.filter((request) => request.status === "CANCELLED").length,
		completed: requests.filter((request) => request.status === "COMPLETED").length,
		failed: requests.filter((request) => request.status === "FAILED").length,
		pending: requests.filter((request) => request.status === "PENDING").length,
		running: requests.filter((request) => request.status === "RUNNING").length,
		total: requests.length,
	};
}

export function normalizeStatusToDb(value: string | undefined) {
	return normalizeStatusToDbValues(value)[0];
}

export function normalizeStatusToDbValues(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	if (value === "COMPLETED") {
		return ["completed"];
	}
	if (value === "FAILED") {
		return ["error", "rejected", "no_answer"];
	}
	if (value === "CANCELLED") {
		return ["cancelled"];
	}
	if (value === "PENDING") {
		return ["accepted", "approval_required", "needs_clarification"];
	}
	if (value === "RUNNING") {
		return ["running"];
	}
	return [];
}

export function normalizeDbStatusToSummaryKey(
	status: string,
): Exclude<keyof OpsRequestSummaryTotals, "total"> {
	const summaryKeys = {
		cancelled: "cancelled",
		completed: "completed",
		error: "failed",
		no_answer: "failed",
		accepted: "pending",
		approval_required: "pending",
		needs_clarification: "pending",
		rejected: "failed",
		running: "running",
	} as const;
	const normalized = status.trim().toLowerCase();
	const summaryKey = summaryKeys[normalized as keyof typeof summaryKeys];
	if (!summaryKey) {
		throw new Error(`Unsupported request projection status: ${status}`);
	}
	return summaryKey;
}

export function readMetricMs(value: unknown) {
	if (!isRecord(value)) {
		return 0;
	}
	return normalizeNonNegativeInteger(value.ms, 0);
}

export function readMetricCount(value: unknown, key: string) {
	if (!isRecord(value)) {
		return 0;
	}
	return normalizeNonNegativeInteger(value[key], 0);
}

function normalizeWorkflowTrace(value: unknown): {
	branch: string | null;
	firstDecisionActor: string | null;
	mode: string | null;
	planningOutcome: string | null;
	runtimeVersions: OpsRequestDetailResponse["workflowSummary"]["runtimeVersions"];
	selectedTools: string[];
	steps: OpsRequestDetailResponse["stepTrajectory"];
	terminalReason: string | null;
} {
	const record = isRecord(value) ? value : {};
	const rawSteps = firstArray(record.steps, record.traceSteps, record.trace_steps);
	const steps = rawSteps
		.map((item) => (isRecord(item) ? item : null))
		.filter((item): item is Record<string, unknown> => Boolean(item))
		.map(normalizeWorkflowTraceStep);

	return {
		branch: normalizeNullableString(
			record.directVsDelegateBranch ?? record.direct_vs_delegate_branch,
		),
		firstDecisionActor: normalizeNullableString(
			record.firstDecisionActor ?? record.first_decision_actor,
		),
		mode: normalizeNullableString(record.workflowMode ?? record.workflow_mode),
		planningOutcome: normalizeNullableString(record.planningOutcome ?? record.planning_outcome),
		runtimeVersions: normalizeJsonRecord(record.runtimeVersions ?? record.runtime_versions),
		selectedTools: normalizeStringArray(record.selectedTools ?? record.selected_tools),
		steps,
		terminalReason: normalizeNullableString(record.terminalReason ?? record.terminal_reason),
	};
}

function firstArray(...values: unknown[]): unknown[] {
	return values.find((value): value is unknown[] => Array.isArray(value)) ?? [];
}

function normalizeWorkflowTraceStep(
	item: Record<string, unknown>,
): OpsRequestDetailResponse["stepTrajectory"][number] {
	const spanKind = normalizeNullableString(item.spanKind ?? item.span_kind);
	const toolName = normalizeNullableString(item.toolName ?? item.tool_name ?? item.tool);
	const stepId = normalizeNonEmptyString(
		item.stepId ?? item.step_id,
		stageFromSpanKind(spanKind, toolName),
	);
	const retryCount = normalizeNullableNonNegativeInteger(item.retryCount ?? item.retry_count);
	const resultStatus = normalizeNullableString(item.resultStatus ?? item.result_status);
	return {
		outcome: normalizeNullableString(item.outcome),
		parentStepId: normalizeNullableString(item.parentStepId ?? item.parent_step_id),
		resultStatus,
		retryCount: retryCount ?? 0,
		spanKind: spanKind ?? "unknown",
		status: normalizeTraceStepStatus(item.status ?? resultStatus),
		stepId,
		toolName,
	};
}

function stageFromSpanKind(spanKind: string | null, toolName: string | null): string {
	if (spanKind === "tool_call") {
		return toolName ? `tool.${toolName}` : "tool.call";
	}
	if (spanKind === "agent") {
		return "agent.primary";
	}
	if (spanKind === "finalization") {
		return "finalization.write";
	}
	if (spanKind === "runtime_policy") {
		return "runtime.policy";
	}
	if (spanKind) {
		return spanKind.replaceAll("_", ".");
	}
	return "unknown";
}

function normalizeTraceStepStatus(
	value: unknown,
): OpsRequestDetailResponse["stepTrajectory"][number]["status"] {
	const normalized = normalizeNullableString(value)?.toUpperCase();
	if (!normalized) {
		return "UNKNOWN";
	}
	if (
		normalized === "COMPLETED" ||
		normalized === "COMPLETE" ||
		normalized === "FOUND" ||
		normalized === "OK"
	) {
		return "COMPLETED";
	}
	if (normalized === "RUNNING" || normalized === "STARTED") {
		return "RUNNING";
	}
	if (normalized === "CANCELLED" || normalized === "CANCELED") {
		return "CANCELLED";
	}
	if (
		normalized === "FAILED" ||
		normalized === "ERROR" ||
		normalized === "REJECTED" ||
		normalized === "NO_ANSWER" ||
		normalized === "FAIL_CLOSED" ||
		normalized === "TEMPORARILY_UNVERIFIABLE"
	) {
		return "FAILED";
	}
	return "UNKNOWN";
}

function normalizeExternalLinks(
	allowlist: OpsObservabilityLinkAllowlist | undefined,
	workflowId: string | null,
): OpsRequestDetailResponse["externalLinks"] {
	const temporalLink = toTemporalExternalLink(workflowId, allowlist);
	return [temporalLink, toSentryExternalLink(allowlist)].filter(
		(link): link is NonNullable<typeof link> => link !== null,
	);
}

function normalizeSupportingSources(value: unknown): OpsRequestDetailResponse["sources"] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.slice(0, 10).flatMap((item) => {
		if (!isRecord(item)) {
			return [];
		}
		const canonicalUrl = normalizeNullableString(item.canonicalUrl ?? item.canonical_url);
		const sourceTitle = normalizeNullableString(
			item.sourceTitle ?? item.source_title ?? item.title,
		);
		if (!(canonicalUrl && sourceTitle)) {
			return [];
		}
		return [
			{
				canonicalUrl,
				sourceKind: normalizeNullableString(item.sourceKind ?? item.source_kind),
				sourceTitle,
				targetKind: normalizeNullableString(item.targetKind ?? item.target_kind),
				versionId: normalizeNullableString(item.versionId ?? item.version_id),
			},
		];
	});
}

function requestSearchText(request: OpsRequestSummary) {
	return [
		request.requestId,
		request.traceId,
		request.runId,
		request.workflowId,
		request.conversationId,
		request.principalType,
		request.questionPreview,
		request.requestedTool,
		request.selectedTool,
		request.errorCode,
		...request.diagnostics,
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
}

function summarizeRequestDiagnostics(
	row: OpsRequestRow,
	observability: OpsRequestObservabilityRow | null,
) {
	const diagnostics = new Set<string>();
	if (row.errorCode) {
		diagnostics.add(`error: ${row.errorCode}`);
	}

	if (observability?.traceAvailable) {
		diagnostics.add("调用链可用");
	} else {
		diagnostics.add("缺少调用链记录");
	}
	if (observability?.aclAnomalyCode) {
		diagnostics.add(`访问控制异常: ${observability.aclAnomalyCode}`);
	}
	if (observability?.failClosed) {
		diagnostics.add("请求因安全校验未通过而停止");
	}
	return Array.from(diagnostics);
}

function normalizeRequestStatus(value: string): OpsRequestSummary["status"] {
	const normalized = value.trim().toUpperCase();
	if (TERMINAL_STATUSES.has(normalized) || normalized === "RUNNING" || normalized === "PENDING") {
		return normalized as OpsRequestSummary["status"];
	}
	if (normalized === "ERROR" || normalized === "REJECTED" || normalized === "NO_ANSWER") {
		return "FAILED";
	}
	if (normalized === "COMPLETED" || normalized === "COMPLETE") {
		return "COMPLETED";
	}
	throw new Error(`Unsupported request projection status: ${value}`);
}

function missingCorrelationFields(input: { runId: string | null; workflowId: string | null }) {
	const missing: string[] = [];
	if (!input.runId) {
		missing.push("runId");
	}
	if (!input.workflowId) {
		missing.push("workflowId");
	}
	return missing;
}

function normalizeIsoString(value: unknown) {
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (typeof value === "string" && !Number.isNaN(new Date(value).valueOf())) {
		return new Date(value).toISOString();
	}
	return null;
}

function normalizeStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.flatMap((item) => {
				const normalized = normalizeNullableString(item);
				return normalized ? [normalized] : [];
			})
		: [];
}

function normalizeJsonRecord(
	value: unknown,
): OpsRequestDetailResponse["workflowSummary"]["runtimeVersions"] {
	if (!isRecord(value)) {
		return {};
	}
	try {
		const normalized = JSON.parse(JSON.stringify(value)) as unknown;
		return isRecord(normalized)
			? (normalized as OpsRequestDetailResponse["workflowSummary"]["runtimeVersions"])
			: {};
	} catch {
		return {};
	}
}

function toTemporalWorkflowId(runId: string | null): string | null {
	return runId ? `campus-agent.chat.${runId}` : null;
}

function normalizeNonEmptyString(value: unknown, fallback: string) {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeNullableString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number) {
	return typeof value === "number" &&
		Number.isFinite(value) &&
		Number.isInteger(value) &&
		value >= 0
		? value
		: fallback;
}

function normalizeNullableNonNegativeInteger(value: unknown) {
	return typeof value === "number" &&
		Number.isFinite(value) &&
		Number.isInteger(value) &&
		value >= 0
		? value
		: null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
