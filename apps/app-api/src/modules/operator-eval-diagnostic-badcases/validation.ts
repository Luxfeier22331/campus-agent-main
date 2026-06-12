import { AppApiRouteError } from "../../http";
import {
	EVAL_DIAGNOSTIC_BADCASES_SCHEMA_VERSION,
	type EvalDiagnosticBadcasePayloadItem,
	type EvalDiagnosticBadcasesProjection,
	type EvalDiagnosticFailureStage,
	type EvalDiagnosticTrajectoryAttribution,
	type EvalDiagnosticTrajectoryAttributionStatus,
	type EvalDiagnosticTrajectoryOutcome,
} from "./types";

const ALLOWED_FAILURE_STAGES = new Set([
	"routing",
	"planning",
	"tool",
	"retrieval",
	"rerank",
	"selection",
	"evidence_selection",
	"synthesis",
	"grounding",
	"finalization",
	"diagnostic",
]);
const ALLOWED_TRAJECTORY_ATTRIBUTION_STATUSES = new Set([
	"attributed",
	"attribution_missing",
	"trajectory_missing",
]);
const FORBIDDEN_KEY_TOKENS = new Set([
	"artifactpath",
	"auth",
	"authheader",
	"authorization",
	"bucket",
	"cookie",
	"localpath",
	"objectkey",
	"path",
	"rawanswer",
	"rawprompt",
	"token",
	"transcript",
]);

function validationError(field: string, message: string): AppApiRouteError {
	return new AppApiRouteError({
		code: "validation_failed",
		details: { field },
		message,
		retryable: false,
		status: 422,
	});
}

function normalizeKey(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replaceAll(/[^a-z0-9]/g, "");
}

function assertNoForbiddenKeys(value: unknown, path = "$"): void {
	if (!value || typeof value !== "object") {
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			assertNoForbiddenKeys(item, `${path}[${index}]`);
		});
		return;
	}
	for (const [key, nestedValue] of Object.entries(value)) {
		if (FORBIDDEN_KEY_TOKENS.has(normalizeKey(key))) {
			throw validationError(`${path}.${key}`, `${path}.${key} is forbidden.`);
		}
		assertNoForbiddenKeys(nestedValue, `${path}.${key}`);
	}
}

function ensureObject(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw validationError(field, `${field} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw validationError(field, `${field} is required.`);
	}
	return value.trim();
}

function optionalString(value: unknown, field: string): string | null {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	if (typeof value !== "string") {
		throw validationError(field, `${field} must be a string or null.`);
	}
	return value.trim() || null;
}

function requiredNullableString(value: unknown, field: string): string | null {
	if (value === null) {
		return null;
	}
	return requiredString(value, field);
}

function requiredArray(value: unknown, field: string): unknown[] {
	if (!Array.isArray(value)) {
		throw validationError(field, `${field} must be an array.`);
	}
	return value;
}

function requiredStringArray(value: unknown, field: string): string[] {
	return requiredArray(value, field).map((item, index) =>
		requiredString(item, `${field}[${index}]`),
	);
}

function requiredScore(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
		throw validationError(field, `${field} must be a number between 0 and 1.`);
	}
	return value;
}

function requiredIsoTimestamp(value: unknown, field: string): string {
	const normalized = requiredString(value, field);
	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.valueOf())) {
		throw validationError(field, `${field} must be a valid ISO timestamp.`);
	}
	return parsed.toISOString();
}

function normalizeFailureStage(value: unknown, field: string): EvalDiagnosticFailureStage {
	const normalized = requiredString(value, field);
	if (!ALLOWED_FAILURE_STAGES.has(normalized)) {
		throw validationError(field, `${field} is unsupported.`);
	}
	return normalized as EvalDiagnosticFailureStage;
}

function normalizeTrajectoryAttributionStatus(
	value: unknown,
	field: string,
): EvalDiagnosticTrajectoryAttributionStatus {
	const normalized = requiredString(value, field);
	if (!ALLOWED_TRAJECTORY_ATTRIBUTION_STATUSES.has(normalized)) {
		throw validationError(field, `${field} is unsupported.`);
	}
	return normalized as EvalDiagnosticTrajectoryAttributionStatus;
}

function normalizeTrajectoryOutcome(
	value: unknown,
	field: string,
): EvalDiagnosticTrajectoryOutcome {
	const outcome = ensureObject(value, field);
	return {
		cancelOutcome: requiredNullableString(outcome.cancelOutcome, `${field}.cancelOutcome`),
		failCloseReason: requiredNullableString(outcome.failCloseReason, `${field}.failCloseReason`),
		lateCompletionOutcome: requiredNullableString(
			outcome.lateCompletionOutcome,
			`${field}.lateCompletionOutcome`,
		),
		replanReason: requiredNullableString(outcome.replanReason, `${field}.replanReason`),
		terminalReason: requiredNullableString(outcome.terminalReason, `${field}.terminalReason`),
		timeoutOutcome: requiredNullableString(outcome.timeoutOutcome, `${field}.timeoutOutcome`),
	};
}

function normalizeTrajectoryAttribution(
	value: unknown,
	field: string,
): EvalDiagnosticTrajectoryAttribution {
	const attribution = ensureObject(value, field);
	return {
		capability: requiredNullableString(attribution.capability, `${field}.capability`),
		outcome: normalizeTrajectoryOutcome(attribution.outcome, `${field}.outcome`),
		projectionRefs: requiredStringArray(attribution.projectionRefs, `${field}.projectionRefs`),
		status: normalizeTrajectoryAttributionStatus(attribution.status, `${field}.status`),
		stepId: requiredNullableString(attribution.stepId, `${field}.stepId`),
		stepKind: requiredNullableString(attribution.stepKind, `${field}.stepKind`),
		stepStatus: requiredNullableString(attribution.stepStatus, `${field}.stepStatus`),
		toolName: requiredNullableString(attribution.toolName, `${field}.toolName`),
	};
}

function normalizeBadcase(value: unknown, field: string): EvalDiagnosticBadcasePayloadItem {
	const item = ensureObject(value, field);
	return {
		answerShape: optionalString(item.answerShape, `${field}.answerShape`),
		badcaseId: requiredString(item.badcaseId, `${field}.badcaseId`),
		caseId: requiredString(item.caseId, `${field}.caseId`),
		causeClass: requiredString(item.causeClass, `${field}.causeClass`),
		expectedDocIds: requiredStringArray(item.expectedDocIds, `${field}.expectedDocIds`),
		failureStage: normalizeFailureStage(item.failureStage, `${field}.failureStage`),
		metricFailureReason: requiredString(item.metricFailureReason, `${field}.metricFailureReason`),
		metricName: requiredString(item.metricName, `${field}.metricName`),
		presentationKind: optionalString(item.presentationKind, `${field}.presentationKind`),
		queryPreview: requiredString(item.queryPreview, `${field}.queryPreview`),
		retrievedContextIds: requiredStringArray(
			item.retrievedContextIds,
			`${field}.retrievedContextIds`,
		),
		retrievedDocIds: requiredStringArray(item.retrievedDocIds, `${field}.retrievedDocIds`),
		score: requiredScore(item.score, `${field}.score`),
		supportingChunkIds: requiredStringArray(item.supportingChunkIds, `${field}.supportingChunkIds`),
		supportingDocIds: requiredStringArray(item.supportingDocIds, `${field}.supportingDocIds`),
		surfaceKey: requiredString(item.surfaceKey, `${field}.surfaceKey`),
		threshold: requiredScore(item.threshold, `${field}.threshold`),
		trajectoryAttribution: normalizeTrajectoryAttribution(
			item.trajectoryAttribution,
			`${field}.trajectoryAttribution`,
		),
	};
}

export function normalizeEvalDiagnosticBadcasesProjection(
	payload: unknown,
): EvalDiagnosticBadcasesProjection {
	assertNoForbiddenKeys(payload);
	const item = ensureObject(payload, "payload");
	if (item.schemaVersion !== EVAL_DIAGNOSTIC_BADCASES_SCHEMA_VERSION) {
		throw validationError("schemaVersion", "schemaVersion is unsupported.");
	}
	return {
		badcases: requiredArray(item.badcases, "badcases").map((badcase, index) =>
			normalizeBadcase(badcase, `badcases[${index}]`),
		),
		evalRunId: requiredString(item.evalRunId, "evalRunId"),
		generatedAt: requiredIsoTimestamp(item.generatedAt, "generatedAt"),
		schemaVersion: EVAL_DIAGNOSTIC_BADCASES_SCHEMA_VERSION,
		snapshotId: requiredString(item.snapshotId, "snapshotId"),
		sourceGitHead: requiredString(item.sourceGitHead, "sourceGitHead"),
		sourceReportSchema: requiredString(item.sourceReportSchema, "sourceReportSchema"),
	};
}
