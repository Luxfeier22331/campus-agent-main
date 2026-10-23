import { CitationStageSchema, FailureReasonSchema } from "campus-contracts/citation-diagnostic";
import { hasFailureFilters } from "../../../shared/failure-filters.ts";
import type {
	OpsRequestDetailResponse,
	OpsRequestListResponse,
	OpsRequestListView,
	OpsRequestSummary,
} from "../../../shared/ops-contract.ts";
import { OpsMatchedFailureSchema } from "../../../shared/ops-contract.ts";
import type { OpsRequestListQuery } from "../contract.ts";
import type {
	OpsRequestDetailRow,
	OpsRequestDiagnosticsRows,
	OpsRequestRow,
} from "../store/types.ts";
import { toExecutionDiagnostics } from "./execution.ts";
import { toProductResult, toResultSummary } from "./product.ts";
import {
	deriveRequestLifecyclePhase,
	isRecord,
	normalizeAttentionReason,
	normalizeNullableString,
	normalizeRequestStatus,
	readNullableNonNegativeInteger,
	requestSearchText,
} from "./values.ts";

export function toRequestDetail(
	row: OpsRequestDetailRow,
	diagnostics: OpsRequestDiagnosticsRows,
	generatedAt = new Date(),
	campusWebPublicOrigin?: string,
): OpsRequestDetailResponse {
	const status = normalizeRequestStatus(row.status);
	return {
		conversation: {
			id: row.conversationId,
			userMessageId: row.userMessageId,
			assistantMessageId: row.assistantMessageId,
		},
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
		matchedFailure: readMatchedFailure(row.matchedFailure),
		attentionReason: normalizeAttentionReason(row.attentionReason),
		completedAt: row.completedAt?.toISOString() ?? null,
		durationMs: row.durationMs ?? null,
		executionStage:
			row.executionStepKind && row.executionStepStatus
				? {
						kind: row.executionStepKind,
						status: row.executionStepStatus,
						toolName: row.executionStepToolName,
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

function readMatchedFailure(value: unknown): OpsRequestSummary["matchedFailure"] {
	if (!isRecord(value)) {
		return null;
	}
	const reason = FailureReasonSchema.nullable().safeParse(value.reason ?? null);
	const stage = CitationStageSchema.nullable().safeParse(value.citationStage ?? null);
	return (
		OpsMatchedFailureSchema.safeParse({
			...value,
			sourceCode: normalizeNullableString(value.sourceCode),
			reason: reason.success ? reason.data : null,
			citationStage: stage.success ? stage.data : null,
			diagnosticState:
				reason.success && stage.success
					? reason.data || stage.data
						? "recorded"
						: "not_recorded"
					: "invalid",
		}).data ?? null
	);
}

export function matchesRequestQuery(
	request: OpsRequestSummary,
	query: OpsRequestListQuery,
): boolean {
	if (hasFailureFilters(query) && !request.matchedFailure) {
		return false;
	}
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
): string {
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

export function withMatchedFailure(
	request: OpsRequestSummary,
	detail: OpsRequestDetailResponse | undefined,
	query: OpsRequestListQuery,
): OpsRequestSummary {
	if (!hasFailureFilters(query)) {
		return { ...request, matchedFailure: null };
	}
	const matches: NonNullable<OpsRequestSummary["matchedFailure"]>[] = [];
	for (const stage of detail?.execution.stages ?? []) {
		const failure = stage.failure;
		const code = failure?.code ?? stage.failureKind;
		if (code && query.failureScope !== "terminal") {
			matches.push({
				code,
				reason: failure?.reason ?? null,
				citationStage: failure?.citation?.validation_stage ?? null,
				scope: "stage",
				stepId: stage.stepId ?? null,
				occurredAt: stage.completedAt ?? stage.startedAt ?? request.startedAt,
			});
		}
	}
	const terminal = detail?.execution.terminalFailure;
	if (terminal?.code && query.failureScope !== "stage") {
		matches.push({
			code: terminal.code,
			sourceCode: terminal.sourceCode ?? null,
			reason: terminal.reason ?? null,
			citationStage: terminal.citation?.validation_stage ?? null,
			scope: "terminal",
			stepId: null,
			occurredAt: request.completedAt ?? request.startedAt,
		});
	}
	const matchedFailure =
		matches
			.filter(
				(item) =>
					(!query.failureCode || query.failureCode === item.code) &&
					(!query.failureReason || query.failureReason === item.reason) &&
					(!query.citationStage || query.citationStage === item.citationStage),
			)
			.sort(
				(a, b) =>
					b.occurredAt.localeCompare(a.occurredAt) ||
					a.scope.localeCompare(b.scope) ||
					(b.stepId ?? "").localeCompare(a.stepId ?? ""),
			)[0] ?? null;
	return { ...request, matchedFailure };
}
