import { z } from "zod";
import {
	CitationIndexesSchema,
	type OpsRequestDetailResponse,
	type OpsRequestListResponse,
	type OpsRequestListView,
	type OpsRequestSummary,
} from "../shared/ops-contract.ts";
import type {
	OpsRequestDetailRow,
	OpsRequestDiagnosticsRows,
	OpsRequestListQuery,
	OpsRequestRow,
	OpsRequestStageRow,
	OpsRequestSummaryTotals,
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

export function toRequestDetail(
	row: OpsRequestDetailRow,
	diagnostics: OpsRequestDiagnosticsRows,
	generatedAt = new Date(),
	campusWebPublicOrigin?: string,
): OpsRequestDetailResponse {
	const status = normalizeRequestStatus(row.status);
	return {
		execution: toExecutionDiagnostics(row, diagnostics),
		generatedAt: generatedAt.toISOString(),
		question: {
			text: row.questionText,
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
	};
}

export function toRequestSummary(row: OpsRequestRow): OpsRequestSummary {
	const status = normalizeRequestStatus(row.status);
	return {
		attentionReason: normalizeAttentionReason(row.attentionReason),
		completedAt: row.completedAt?.toISOString() ?? null,
		durationMs: row.durationMs ?? null,
		executionStage:
			row.executionStepKind && row.executionStepStatus
				? {
						kind: row.executionStepKind,
						status: row.executionStepStatus,
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

export function matchesRequestQuery(request: OpsRequestSummary, query: OpsRequestListQuery) {
	if (requestListView(query) === "attention" && request.attentionReason === null) {
		return false;
	}
	if (query.status && request.status !== query.status) {
		return false;
	}
	if (query.requestId && request.requestId !== query.requestId) {
		return false;
	}
	if (query.q && !requestSearchText(request).includes(query.q.toLowerCase())) {
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
	if (reason === "REQUEST_FAILED" || reason === "EXECUTION_STAGE_FAILED") {
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
	diagnostics: OpsRequestDiagnosticsRows,
): OpsRequestDetailResponse["execution"] {
	const stages = diagnostics.stages.map((stage) => {
		const payload = isRecord(stage.sanitizedPayloadJson) ? stage.sanitizedPayloadJson : {};
		const failure = readExecutionFailure(payload.failure);
		return {
			completedAt: stage.completedAt?.toISOString() ?? null,
			durationMs: stageDurationMs(stage.startedAt, stage.completedAt),
			failureKind: failure?.code ?? null,
			kind: stage.stepKind,
			startedAt: stage.startedAt?.toISOString() ?? null,
			status: stage.status,
		};
	});
	const failedStage = diagnostics.stages
		.filter((stage) => {
			const payload = isRecord(stage.sanitizedPayloadJson) ? stage.sanitizedPayloadJson : {};
			return stage.status === "failed" || readExecutionFailure(payload.failure) !== null;
		})
		.sort(compareExecutionStageRecency)[0];
	const failedStagePayload = isRecord(failedStage?.sanitizedPayloadJson)
		? failedStage.sanitizedPayloadJson
		: {};
	const stageFailure = readExecutionFailure(failedStagePayload.failure);
	const failedAttempt = [...diagnostics.modelAttempts].reverse().find((attempt) => {
		const payload = isRecord(attempt.sanitizedPayloadJson) ? attempt.sanitizedPayloadJson : {};
		return attempt.status === "failed" || readExecutionFailure(payload.failure) !== null;
	});
	const failedAttemptPayload = isRecord(failedAttempt?.sanitizedPayloadJson)
		? failedAttempt.sanitizedPayloadJson
		: {};
	const attemptFailure = readExecutionFailure(failedAttemptPayload.failure);
	const failure = mergeExecutionFailures(stageFailure, attemptFailure);
	const modelAttempt = [...diagnostics.modelAttempts]
		.reverse()
		.find(
			(attempt) =>
				normalizeNullableString(attempt.modelName) !== null ||
				normalizeNullableString(attempt.modelProvider) !== null,
		);
	const usageAttempts = diagnostics.modelAttempts.filter((attempt) => attempt.usageObserved);
	const inputTokens = sumAttemptField(usageAttempts, "inputTokens");
	const cachedInputTokens = sumAttemptField(usageAttempts, "cachedInputTokens");
	const outputTokens = sumAttemptField(usageAttempts, "outputTokens");

	return {
		failure: {
			code:
				failure?.code ??
				normalizeNullableString(row.executionFailureKind) ??
				normalizeNullableString(row.errorCode),
			detail: failure?.detail ?? null,
			httpStatus: failure?.httpStatus ?? null,
			invocationId: failure?.invocationId ?? null,
			operation: failure?.operation ?? null,
		},
		model: {
			name: normalizeNullableString(modelAttempt?.modelName),
			provider: normalizeNullableString(modelAttempt?.modelProvider),
			requestCount: diagnostics.modelAttempts.reduce(
				(total, attempt) => total + readDbInteger(attempt.modelRequestCount, "modelRequestCount"),
				0,
			),
			tokens: {
				cachedInput: usageAttempts.length > 0 ? cachedInputTokens : null,
				input: usageAttempts.length > 0 ? inputTokens : null,
				output: usageAttempts.length > 0 ? outputTokens : null,
				total: usageAttempts.length > 0 ? inputTokens + outputTokens : null,
			},
		},
		releases: {
			agentRuntime: diagnosticPayloadString(diagnostics, "agent_runtime_release"),
			executionControl: diagnosticPayloadString(diagnostics, "execution_control_release"),
		},
		stages,
	};
}

function readExecutionFailure(
	value: unknown,
): OpsRequestDetailResponse["execution"]["failure"] | null {
	if (!isRecord(value)) {
		return null;
	}
	const code = normalizeNullableString(value.code);
	const detail = normalizeNullableString(value.detail);
	const httpStatus = readHTTPStatus(value.http_status);
	const invocationId = normalizeNullableString(value.invocation_id);
	const operation = normalizeNullableString(value.operation);
	if (!(code || detail) && httpStatus === null && !invocationId && !operation) {
		return null;
	}
	return { code, detail, httpStatus, invocationId, operation };
}

function mergeExecutionFailures(
	stageFailure: OpsRequestDetailResponse["execution"]["failure"] | null,
	attemptFailure: OpsRequestDetailResponse["execution"]["failure"] | null,
): OpsRequestDetailResponse["execution"]["failure"] | null {
	if (!stageFailure) {
		return attemptFailure;
	}
	if (!(attemptFailure && stageFailure.code) || stageFailure.code !== attemptFailure.code) {
		return stageFailure;
	}
	return {
		code: stageFailure.code,
		detail: stageFailure.detail ?? attemptFailure.detail,
		httpStatus: stageFailure.httpStatus ?? attemptFailure.httpStatus,
		invocationId: stageFailure.invocationId ?? attemptFailure.invocationId,
		operation: stageFailure.operation ?? attemptFailure.operation,
	};
}

function diagnosticPayloadString(
	diagnostics: OpsRequestDiagnosticsRows,
	field: "agent_runtime_release" | "execution_control_release",
): string | null {
	for (const record of [...diagnostics.modelAttempts, ...diagnostics.stages].reverse()) {
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

function stageDurationMs(startedAt: Date | null, completedAt: Date | null): number | null {
	if (!(startedAt && completedAt)) {
		return null;
	}
	const durationMs = completedAt.getTime() - startedAt.getTime();
	if (durationMs < 0) {
		throw new Error("Execution stage completed before it started");
	}
	return durationMs;
}

function compareExecutionStageRecency(left: OpsRequestStageRow, right: OpsRequestStageRow): number {
	return (
		right.updatedAt.valueOf() - left.updatedAt.valueOf() ||
		(right.startedAt?.valueOf() ?? right.updatedAt.valueOf()) -
			(left.startedAt?.valueOf() ?? left.updatedAt.valueOf()) ||
		(right.stepId === left.stepId ? 0 : right.stepId < left.stepId ? -1 : 1)
	);
}

function sumAttemptField(
	attempts: OpsRequestDiagnosticsRows["modelAttempts"],
	field: "cachedInputTokens" | "inputTokens" | "outputTokens",
): number {
	return attempts.reduce((total, attempt) => total + readDbInteger(attempt[field], field), 0);
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
	return value === "RESULT_MISSING" ||
		value === "REQUEST_FAILED" ||
		value === "EXECUTION_STAGE_FAILED" ||
		value === "WAITING_USER"
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

function requestSearchText(request: OpsRequestSummary) {
	return [request.requestId, request.question.preview].join(" ").toLowerCase();
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
