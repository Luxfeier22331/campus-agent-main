import { z } from "zod";
import {
	CitationIndexesSchema,
	type OpsRequestDetailResponse,
	type OpsRequestListResponse,
	type OpsRequestListView,
	type OpsRequestSummary,
} from "../shared/ops-contract.ts";
import {
	type OpsObservabilityLinkAllowlist,
	toLangfuseExternalLink,
	toSentryExternalLink,
	toTemporalExternalLink,
} from "./ops-external-links.ts";
import type {
	OpsRequestDetailRow,
	OpsRequestListQuery,
	OpsRequestRow,
	OpsRequestSummaryTotals,
	OpsRunDiagnosticsRows,
} from "./ops-status-types.ts";

const TERMINAL_STATUSES = new Set<OpsRequestSummary["status"]>([
	"COMPLETED",
	"FAILED",
	"CANCELLED",
	"ACTION_REQUIRED",
]);

const ProductSourceActionSchema = z.object({
	disabledReason: z.null(),
	external: z.literal(false),
	href: z.string().min(1),
	label: z.literal("查看文档"),
});

const ProductSourceItemSchema = z.object({
	citationIndexes: CitationIndexesSchema,
	collectionLabel: z.string(),
	kind: z.literal("campus_document"),
	primaryAction: ProductSourceActionSchema,
	sectionTitle: z.string(),
	snippet: z.string().nullable(),
	title: z.string().min(1),
	versionLabel: z.string(),
});

const ProductSourcePartSchema = z.object({
	sourceItems: z.array(ProductSourceItemSchema),
	type: z.literal("source_items"),
});

export async function toRequestDetail(
	row: OpsRequestDetailRow,
	diagnostics: OpsRunDiagnosticsRows,
	observabilityLinks?: OpsObservabilityLinkAllowlist,
	generatedAt = new Date(),
	campusWebPublicOrigin?: string,
): Promise<OpsRequestDetailResponse> {
	const status = normalizeRequestStatus(row.status);
	const runId = normalizeNullableString(row.runId);
	return {
		execution: toExecutionDiagnostics(row, diagnostics),
		generatedAt: generatedAt.toISOString(),
		question: {
			text: row.questionText,
			turnSequence: row.turnSequence,
		},
		request: {
			completedAt: row.completedAt?.toISOString() ?? null,
			durationMs: row.durationMs ?? null,
			lifecyclePhase: deriveRequestLifecyclePhase(row, status),
			requestId: row.requestId,
			startedAt: row.startedAt.toISOString(),
			status,
		},
		result: toProductResult(row, status, campusWebPublicOrigin),
		technical: {
			correlationIds: {
				conversationId: row.conversationId,
				requestId: row.requestId,
				runId,
				traceId: row.traceId,
				workflowId: normalizeNullableString(row.workflowId),
			},
			externalLinks: await normalizeExternalLinks(
				observabilityLinks,
				row.traceId,
				normalizeNullableString(row.workflowId),
			),
			runtimeVersions: normalizeJsonRecord(row.runtimeVersionsJson),
		},
	};
}

export function toRequestSummary(row: OpsRequestRow): OpsRequestSummary {
	const status = normalizeRequestStatus(row.status);
	return {
		attentionReason: normalizeAttentionReason(row.attentionReason),
		completedAt: row.completedAt?.toISOString() ?? null,
		durationMs: row.durationMs ?? null,
		executionStage:
			row.executionStepId && row.executionStepKind && row.executionStepStatus
				? {
						kind: row.executionStepKind,
						status: row.executionStepStatus,
						stepId: row.executionStepId,
					}
				: null,
		failureKind: normalizeNullableString(row.executionFailureKind),
		lifecyclePhase: deriveRequestLifecyclePhase(row, status),
		question: {
			preview: row.questionPreview,
			truncated: row.questionTruncated,
		},
		requestId: row.requestId,
		result: toResultSummary(row, status),
		startedAt: row.startedAt.toISOString(),
		status,
	};
}

export function matchesRequestQuery(
	request: OpsRequestSummary,
	query: OpsRequestListQuery,
	correlationIds?: OpsRequestDetailResponse["technical"]["correlationIds"],
) {
	if (requestListView(query) === "attention" && request.attentionReason === null) {
		return false;
	}
	if (query.status && request.status !== query.status) {
		return false;
	}
	if (query.requestId && request.requestId !== query.requestId) {
		return false;
	}
	if (query.conversationId && correlationIds?.conversationId !== query.conversationId) {
		return false;
	}
	if (query.runId && correlationIds?.runId !== query.runId) {
		return false;
	}
	if (query.traceId && correlationIds?.traceId !== query.traceId) {
		return false;
	}
	if (query.workflowId && correlationIds?.workflowId !== query.workflowId) {
		return false;
	}
	if (query.q && !requestSearchText(request, correlationIds).includes(query.q.toLowerCase())) {
		return false;
	}
	return true;
}

export type RequestKeysetCursor =
	| { requestId: string; startedAt: string; v: 2; view: "recent" }
	| { priority: 0 | 1 | 2; requestId: string; startedAt: string; v: 2; view: "attention" };

export function encodeRequestCursor(
	row: Pick<OpsRequestSummary, "attentionReason" | "requestId" | "startedAt">,
	view: OpsRequestListView = "recent",
) {
	return Buffer.from(
		JSON.stringify(
			view === "attention"
				? {
						priority: requestAttentionPriority(row.attentionReason),
						requestId: row.requestId,
						startedAt: row.startedAt,
						v: 2,
						view,
					}
				: { requestId: row.requestId, startedAt: row.startedAt, v: 2, view },
		),
		"utf8",
	).toString("base64url");
}

export function decodeRequestCursor(
	cursor: string | undefined,
	expectedView?: OpsRequestListView,
): RequestKeysetCursor | null {
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
		const view = parsed.view === "recent" || parsed.view === "attention" ? parsed.view : null;
		if (
			parsed.v !== 2 ||
			!requestId ||
			!startedAt ||
			!view ||
			(expectedView && view !== expectedView) ||
			!Number.isFinite(Date.parse(startedAt))
		) {
			return null;
		}
		if (view === "recent") {
			return { requestId, startedAt, v: 2, view };
		}
		const priority = readNullableNonNegativeInteger(parsed.priority);
		return priority === 0 || priority === 1 || priority === 2
			? { priority, requestId, startedAt, v: 2, view }
			: null;
	} catch {
		return null;
	}
}

export function requestListView(query: Pick<OpsRequestListQuery, "view">): OpsRequestListView {
	return query.view ?? "recent";
}

export function requestAttentionPriority(reason: OpsRequestSummary["attentionReason"]): 0 | 1 | 2 {
	if (reason === "RESULT_MISSING") {
		return 0;
	}
	if (reason === "REQUEST_FAILED") {
		return 1;
	}
	if (reason === "WAITING_USER") {
		return 2;
	}
	throw new Error("Request is not eligible for the attention view");
}

export function compareRequestsForView(
	left: Pick<OpsRequestSummary, "attentionReason" | "requestId" | "startedAt">,
	right: Pick<OpsRequestSummary, "attentionReason" | "requestId" | "startedAt">,
	view: OpsRequestListView,
): number {
	const priority =
		view === "attention"
			? requestAttentionPriority(left.attentionReason) -
				requestAttentionPriority(right.attentionReason)
			: 0;
	return (
		priority ||
		Date.parse(right.startedAt) - Date.parse(left.startedAt) ||
		(right.requestId === left.requestId ? 0 : right.requestId < left.requestId ? -1 : 1)
	);
}

export function summarizeRequests(
	requests: OpsRequestSummary[],
): OpsRequestListResponse["statusCounts"] {
	return {
		actionRequired: requests.filter((request) => request.status === "ACTION_REQUIRED").length,
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
		return ["error", "rejected"];
	}
	if (value === "CANCELLED") {
		return ["cancelled"];
	}
	if (value === "PENDING") {
		return ["accepted"];
	}
	if (value === "ACTION_REQUIRED") {
		return ["approval_required"];
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
		action_required: "actionRequired",
		cancelled: "cancelled",
		completed: "completed",
		error: "failed",
		accepted: "pending",
		approval_required: "actionRequired",
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
	return readNonNegativeInteger(value.ms, 0);
}

export function readMetricCount(value: unknown, key: string) {
	if (!isRecord(value)) {
		return 0;
	}
	return readNonNegativeInteger(value[key], 0);
}

function toResultSummary(
	row: Pick<OpsRequestRow, "assistantKind" | "assistantMessagePresent">,
	status: OpsRequestSummary["status"],
): OpsRequestSummary["result"] {
	if (row.assistantMessagePresent) {
		return { kind: normalizeAssistantKind(row.assistantKind), state: "WRITTEN" };
	}
	return TERMINAL_STATUSES.has(status)
		? { kind: null, state: "MISSING" }
		: { kind: null, state: "PENDING" };
}

function toProductResult(
	row: OpsRequestDetailRow,
	status: OpsRequestSummary["status"],
	campusWebPublicOrigin?: string,
): OpsRequestDetailResponse["result"] {
	if (row.assistantMessagePresent) {
		if (row.assistantMessageText === null) {
			throw new Error("Assistant message is present without text");
		}
		return {
			kind: normalizeAssistantKind(row.assistantKind),
			sources: normalizeProductSources(row.assistantStructuredPartsJson, campusWebPublicOrigin),
			state: "WRITTEN",
			text: row.assistantMessageText,
		};
	}
	return TERMINAL_STATUSES.has(status)
		? { reasonCode: "ASSISTANT_MESSAGE_MISSING", state: "MISSING" }
		: { state: "PENDING" };
}

function normalizeProductSourceAction(
	action: z.infer<typeof ProductSourceActionSchema>,
	campusWebPublicOrigin?: string,
): Extract<
	OpsRequestDetailResponse["result"],
	{ state: "WRITTEN" }
>["sources"][number]["primaryAction"] {
	const href = action.href.trim();
	if (!campusWebPublicOrigin) {
		return invalidSourceAction(action, "Campus Web 地址未配置。");
	}
	try {
		const parsed = new URL(href, campusWebPublicOrigin);
		if (
			href.startsWith("//") ||
			(!href.startsWith("/") && parsed.origin !== campusWebPublicOrigin)
		) {
			return invalidSourceAction(action);
		}
		if (parsed.origin !== campusWebPublicOrigin || parsed.username || parsed.password) {
			return invalidSourceAction(action);
		}
		return { ...action, href: parsed.href };
	} catch {
		return invalidSourceAction(action);
	}
}

function invalidSourceAction(
	action: z.infer<typeof ProductSourceActionSchema>,
	disabledReason = "来源链接地址无效。",
): Extract<
	OpsRequestDetailResponse["result"],
	{ state: "WRITTEN" }
>["sources"][number]["primaryAction"] {
	return { ...action, disabledReason, href: null };
}

function normalizeProductSources(
	value: unknown,
	campusWebPublicOrigin?: string,
): Extract<OpsRequestDetailResponse["result"], { state: "WRITTEN" }>["sources"] {
	if (!Array.isArray(value)) {
		return [];
	}
	const sources: Extract<OpsRequestDetailResponse["result"], { state: "WRITTEN" }>["sources"] = [];
	for (const part of value) {
		const parsed = ProductSourcePartSchema.safeParse(part);
		if (!parsed.success) {
			continue;
		}
		for (const source of parsed.data.sourceItems) {
			sources.push({
				...source,
				primaryAction: normalizeProductSourceAction(source.primaryAction, campusWebPublicOrigin),
			});
			if (sources.length === 5) {
				return sources;
			}
		}
	}
	return sources;
}

function toExecutionDiagnostics(
	row: OpsRequestDetailRow,
	diagnostics: OpsRunDiagnosticsRows,
): OpsRequestDetailResponse["execution"] {
	const attemptsByStep = new Map<
		string,
		OpsRequestDetailResponse["execution"]["steps"][number]["attempts"]
	>();
	for (const attempt of diagnostics.attempts) {
		const attempts = attemptsByStep.get(attempt.stepId) ?? [];
		const payload = isRecord(attempt.sanitizedPayloadJson) ? attempt.sanitizedPayloadJson : {};
		attempts.push({
			activityAttempt: readDbInteger(attempt.activityAttempt, "activityAttempt"),
			activityType: normalizeNullableString(attempt.activityType),
			attempt: readDbInteger(attempt.attempt, "attempt"),
			completedAt: attempt.completedAt?.toISOString() ?? null,
			durationMs: readDbInteger(attempt.durationMs, "durationMs"),
			failure: {
				agentRuntimeHttpStatus: readHTTPStatus(payload.agent_runtime_http_status),
				failCloseReason: normalizeNullableString(attempt.failCloseReason),
				kind: normalizeNullableString(payload.failure_kind),
				runtimeErrorCode: normalizeNullableString(payload.agent_runtime_error_code),
				terminalReason: normalizeNullableString(attempt.terminalReason),
			},
			modelName: normalizeNullableString(attempt.modelName),
			modelProvider: normalizeNullableString(attempt.modelProvider),
			modelRequestCount: readDbInteger(attempt.modelRequestCount, "modelRequestCount"),
			providerResponseId: normalizeNullableString(attempt.providerResponseId),
			scheduleToStartMs: readDbInteger(attempt.scheduleToStartMs, "scheduleToStartMs"),
			scheduledAt: attempt.scheduledAt?.toISOString() ?? null,
			startedAt: attempt.startedAt?.toISOString() ?? null,
			status: attempt.status,
			taskQueue: normalizeNullableString(attempt.taskQueue),
			tokens: attempt.usageObserved
				? {
						cachedInput: readDbInteger(attempt.cachedInputTokens, "cachedInputTokens"),
						input: readDbInteger(attempt.inputTokens, "inputTokens"),
						output: readDbInteger(attempt.outputTokens, "outputTokens"),
					}
				: { cachedInput: null, input: null, output: null },
			workerId: normalizeNullableString(attempt.workerId),
		});
		attemptsByStep.set(attempt.stepId, attempts);
	}

	const steps = diagnostics.steps.map((step) => {
		const payload = isRecord(step.sanitizedPayloadJson) ? step.sanitizedPayloadJson : {};
		return {
			attempts: attemptsByStep.get(step.stepId) ?? [],
			completedAt: step.completedAt?.toISOString() ?? null,
			failureKind: normalizeNullableString(payload.failure_kind),
			kind: step.stepKind,
			parentStepId: normalizeNullableString(step.parentStepId),
			startedAt: step.startedAt?.toISOString() ?? null,
			status: step.status,
			stepId: step.stepId,
			taskQueue: normalizeNullableString(step.taskQueue),
			tool: normalizeNullableString(step.tool),
			workerId: normalizeNullableString(step.workerId),
		};
	});
	const failedAttempt = [...steps]
		.reverse()
		.flatMap((step) => [...step.attempts].reverse())
		.find(
			(attempt) =>
				attempt.status === "failed" ||
				attempt.failure.kind !== null ||
				attempt.failure.runtimeErrorCode !== null,
		);
	const failedStep = [...steps]
		.reverse()
		.find((step) => step.status === "failed" || step.failureKind !== null);

	return {
		failure: {
			agentRuntimeHttpStatus: failedAttempt?.failure.agentRuntimeHttpStatus ?? null,
			failCloseReason:
				failedAttempt?.failure.failCloseReason ?? normalizeNullableString(row.failCloseReason),
			kind:
				failedAttempt?.failure.kind ??
				failedStep?.failureKind ??
				normalizeNullableString(row.executionFailureKind) ??
				normalizeNullableString(row.errorCode),
			runtimeErrorCode: failedAttempt?.failure.runtimeErrorCode ?? null,
			terminalReason:
				failedAttempt?.failure.terminalReason ?? normalizeNullableString(row.terminalReason),
		},
		releases: {
			agentRuntime: diagnosticPayloadString(diagnostics, "agent_runtime_release"),
			executionControl: diagnosticPayloadString(diagnostics, "execution_control_release"),
		},
		steps,
	};
}

function diagnosticPayloadString(
	diagnostics: OpsRunDiagnosticsRows,
	field: "agent_runtime_release" | "execution_control_release",
): string | null {
	for (const record of [...diagnostics.attempts, ...diagnostics.steps].reverse()) {
		if (!isRecord(record.sanitizedPayloadJson)) {
			continue;
		}
		const value = normalizeNullableString(record.sanitizedPayloadJson[field]);
		if (value) {
			return value;
		}
	}
	return null;
}

function readHTTPStatus(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
		? value
		: null;
}

function readDbInteger(value: number | string | null, field: string): number {
	const normalized = typeof value === "string" && value.trim() ? Number(value) : value;
	if (!(typeof normalized === "number" && Number.isSafeInteger(normalized) && normalized >= 0)) {
		throw new Error(`Execution diagnostic ${field} must be a non-negative safe integer`);
	}
	return normalized;
}

function normalizeAssistantKind(value: unknown) {
	if (value === "answer" || value === "error") {
		return value;
	}
	throw new Error("Assistant message kind is invalid");
}

function normalizeAttentionReason(value: unknown): OpsRequestSummary["attentionReason"] {
	return value === "RESULT_MISSING" || value === "REQUEST_FAILED" || value === "WAITING_USER"
		? value
		: null;
}

function normalizeRequestStatus(value: string): OpsRequestSummary["status"] {
	const normalized = value.trim().toUpperCase();
	if (TERMINAL_STATUSES.has(normalized as OpsRequestSummary["status"])) {
		return normalized as OpsRequestSummary["status"];
	}
	if (normalized === "RUNNING") {
		return "RUNNING";
	}
	if (normalized === "PENDING") {
		return "PENDING";
	}
	if (normalized === "ERROR" || normalized === "REJECTED") {
		return "FAILED";
	}
	if (normalized === "ACCEPTED") {
		return "PENDING";
	}
	if (normalized === "APPROVAL_REQUIRED") {
		return "ACTION_REQUIRED";
	}
	if (normalized === "COMPLETED" || normalized === "COMPLETE") {
		return "COMPLETED";
	}
	throw new Error(`Unsupported request projection status: ${value}`);
}

function deriveRequestLifecyclePhase(
	row: OpsRequestRow,
	status: OpsRequestSummary["status"],
): OpsRequestSummary["lifecyclePhase"] {
	if (TERMINAL_STATUSES.has(status)) {
		return "FINISHED";
	}
	const runStatus = normalizeNullableString(row.runStatus)?.toLowerCase();
	if (runStatus === "streaming") {
		return "STREAMING";
	}
	if (runStatus === "running") {
		return "RUNNING";
	}
	if (
		runStatus &&
		["completed", "failed", "expired", "canceled", "cancelled"].includes(runStatus)
	) {
		return "FINALIZING";
	}
	if (runStatus && ["created", "queued", "admitted"].includes(runStatus)) {
		return "QUEUED";
	}
	return status === "PENDING" ? "QUEUED" : "RUNNING";
}

async function normalizeExternalLinks(
	allowlist: OpsObservabilityLinkAllowlist | undefined,
	productTraceId: string,
	workflowId: string | null,
): Promise<OpsRequestDetailResponse["technical"]["externalLinks"]> {
	const temporalLink = toTemporalExternalLink(workflowId, allowlist);
	const langfuseLink = await toLangfuseExternalLink(productTraceId, allowlist);
	return [temporalLink, langfuseLink, toSentryExternalLink(allowlist)].filter(
		(link): link is NonNullable<typeof link> => link !== null,
	);
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function normalizeJsonRecord(value: unknown): Record<string, JsonValue> {
	if (!isRecord(value)) {
		return {};
	}
	try {
		const normalized = JSON.parse(JSON.stringify(value)) as unknown;
		return isRecord(normalized) ? (normalized as Record<string, JsonValue>) : {};
	} catch {
		return {};
	}
}

function requestSearchText(
	request: OpsRequestSummary,
	correlationIds?: OpsRequestDetailResponse["technical"]["correlationIds"],
) {
	return [
		request.requestId,
		request.question.preview,
		correlationIds?.traceId,
		correlationIds?.runId,
		correlationIds?.workflowId,
		correlationIds?.conversationId,
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
}

function normalizeNullableString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNonNegativeInteger(value: unknown, fallback: number) {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function readNullableNonNegativeInteger(value: unknown) {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
