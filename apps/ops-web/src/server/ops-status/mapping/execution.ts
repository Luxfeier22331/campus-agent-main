import { ModelOutputDiagnosticSchema } from "../../../shared/model-output-diagnostic.ts";
import type { OpsRequestDetailResponse } from "../../../shared/ops-contract.ts";
import type {
	OpsRequestDetailRow,
	OpsRequestDiagnosticsRows,
	OpsRequestStageRow,
} from "../store/types.ts";
import { toCampusSearchDiagnostics } from "./campus-search.ts";
import { isRecord, normalizeNullableString } from "./values.ts";

export function toExecutionDiagnostics(
	row: OpsRequestDetailRow,
	diagnostics: OpsRequestDiagnosticsRows,
): OpsRequestDetailResponse["execution"] {
	const stages = diagnostics.stages.map((stage) => {
		const payload = isRecord(stage.sanitizedPayloadJson) ? stage.sanitizedPayloadJson : {};
		const failure = readExecutionFailure(payload.failure);
		return {
			modelOutputDiagnostic:
				ModelOutputDiagnosticSchema.safeParse(stage.modelOutputDiagnosticJson).data ?? null,
			completedAt: stage.completedAt?.toISOString() ?? null,
			durationMs: stageDurationMs(stage),
			failureKind: failure?.code ?? null,
			kind: stage.stepKind,
			invocationId: normalizeNullableString(payload.invocation_id),
			startedAt: stage.startedAt?.toISOString() ?? null,
			status: stage.status,
			toolName: normalizeNullableString(payload.tool_name),
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
		campusSearch: toCampusSearchDiagnostics(diagnostics.campusSearch, row.completedAt !== null),
		failCloseReason: normalizeNullableString(row.failCloseReason),
		failure: {
			code: failure?.code ?? null,
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
		terminalReason: normalizeNullableString(row.terminalReason),
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

function stageDurationMs(stage: OpsRequestStageRow): number | null {
	const storedDuration = readStoredDurationMs(stage.durationMs);
	if (storedDuration !== null) {
		return storedDuration;
	}
	const { startedAt, completedAt } = stage;
	if (!(startedAt && completedAt)) {
		return null;
	}
	const durationMs = completedAt.getTime() - startedAt.getTime();
	if (durationMs < 0) {
		throw new Error("Execution stage completed before it started");
	}
	return durationMs;
}

function readStoredDurationMs(value: number | string | null): number | null {
	const normalized = typeof value === "string" && value.trim() ? Number(value) : value;
	return typeof normalized === "number" && Number.isSafeInteger(normalized) && normalized >= 0
		? normalized
		: null;
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
