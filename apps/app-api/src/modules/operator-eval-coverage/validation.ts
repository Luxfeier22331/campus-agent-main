import { AppApiRouteError } from "../../http";
import {
	EVAL_COVERAGE_DENOMINATOR_SURFACES,
	EVAL_COVERAGE_SNAPSHOT_SCHEMA_VERSION,
	type EvalCoverageGateSnapshot,
	type EvalCoverageRagasDiagnostic,
	type EvalCoverageSnapshot,
	type EvalCoverageSurfaceKey,
	type EvalCoverageSurfaceSnapshot,
} from "./types";

const FORBIDDEN_KEYS = new Set([
	"auth",
	"authheader",
	"authorization",
	"cookie",
	"path",
	"rawanswer",
	"rawprompt",
	"token",
	"transcript",
]);

const RAGAS_STATUSES = new Set([
	"artifact_missing",
	"diagnostic_attention",
	"missing_for_surface",
	"present",
]);
const GATE_STATUSES = new Set(["failed", "passed"]);
const MATURITY_STATUSES = new Set(["gap", "ready"]);
const READINESS_STATUSES = new Set(["blocked", "diagnostic_attention", "ready"]);

function validationError(field: string, message: string): AppApiRouteError {
	return new AppApiRouteError({
		code: "validation_failed",
		details: { field },
		message,
		retryable: false,
		status: 422,
	});
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

function requiredNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw validationError(field, `${field} must be a finite number.`);
	}
	return value;
}

function requiredNonNegativeInteger(value: unknown, field: string): number {
	const number = requiredNumber(value, field);
	if (!Number.isInteger(number) || number < 0) {
		throw validationError(field, `${field} must be a non-negative integer.`);
	}
	return number;
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

function requiredIsoTimestamp(value: unknown, field: string): string {
	const normalized = requiredString(value, field);
	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.valueOf())) {
		throw validationError(field, `${field} must be a valid ISO timestamp.`);
	}
	return parsed.toISOString();
}

function assertExactCurrentSurfaces(value: unknown, field: string): EvalCoverageSurfaceKey[] {
	const surfaces = requiredStringArray(value, field);
	if (
		surfaces.length !== EVAL_COVERAGE_DENOMINATOR_SURFACES.length ||
		surfaces.some((surface, index) => surface !== EVAL_COVERAGE_DENOMINATOR_SURFACES[index])
	) {
		throw validationError(field, `${field} must match the current RAG denominator surfaces.`);
	}
	return [...EVAL_COVERAGE_DENOMINATOR_SURFACES];
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
		if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
			throw validationError(`${path}.${key}`, `${path}.${key} is forbidden.`);
		}
		assertNoForbiddenKeys(nestedValue, `${path}.${key}`);
	}
}

function normalizeRagasDiagnostic(value: unknown, field: string): EvalCoverageRagasDiagnostic {
	const item = ensureObject(value, field);
	const status = requiredString(item.status, `${field}.status`);
	if (!RAGAS_STATUSES.has(status)) {
		throw validationError(`${field}.status`, `${field}.status is unsupported.`);
	}
	return {
		caseCount: requiredNonNegativeInteger(item.caseCount, `${field}.caseCount`),
		completedCaseCount: requiredNonNegativeInteger(
			item.completedCaseCount,
			`${field}.completedCaseCount`,
		),
		failedCaseCount: requiredNonNegativeInteger(item.failedCaseCount, `${field}.failedCaseCount`),
		lowScoreCases: requiredArray(item.lowScoreCases, `${field}.lowScoreCases`).map(
			(caseItem, index) => {
				const lowScore = ensureObject(caseItem, `${field}.lowScoreCases[${index}]`);
				return {
					caseId: requiredString(lowScore.caseId, `${field}.lowScoreCases[${index}].caseId`),
					metricName: requiredString(
						lowScore.metricName,
						`${field}.lowScoreCases[${index}].metricName`,
					),
					score: requiredNumber(lowScore.score, `${field}.lowScoreCases[${index}].score`),
				};
			},
		),
		metrics: requiredArray(item.metrics, `${field}.metrics`).map((metricItem, index) => {
			const metric = ensureObject(metricItem, `${field}.metrics[${index}]`);
			return {
				count: requiredNonNegativeInteger(metric.count, `${field}.metrics[${index}].count`),
				max: requiredNumber(metric.max, `${field}.metrics[${index}].max`),
				mean: requiredNumber(metric.mean, `${field}.metrics[${index}].mean`),
				min: requiredNumber(metric.min, `${field}.metrics[${index}].min`),
				name: requiredString(metric.name, `${field}.metrics[${index}].name`),
			};
		}),
		status: status as EvalCoverageRagasDiagnostic["status"],
	};
}

function normalizeGate(value: unknown, field: string, surfaceKey: EvalCoverageSurfaceKey) {
	const item = ensureObject(value, field);
	const status = requiredString(item.status, `${field}.status`);
	if (!GATE_STATUSES.has(status)) {
		throw validationError(`${field}.status`, `${field}.status is unsupported.`);
	}
	const gateSurface = requiredString(item.surfaceKey, `${field}.surfaceKey`);
	if (gateSurface !== surfaceKey) {
		throw validationError(`${field}.surfaceKey`, `${field}.surfaceKey must match surfaceKey.`);
	}
	return {
		artifactId: requiredString(item.artifactId, `${field}.artifactId`),
		artifactKind: requiredString(item.artifactKind, `${field}.artifactKind`),
		caseCount: requiredNonNegativeInteger(item.caseCount, `${field}.caseCount`),
		failedCount: requiredNonNegativeInteger(item.failedCount, `${field}.failedCount`),
		gitHead: requiredString(item.gitHead, `${field}.gitHead`),
		passedCount: requiredNonNegativeInteger(item.passedCount, `${field}.passedCount`),
		profileId: requiredString(item.profileId, `${field}.profileId`),
		reasons: requiredStringArray(item.reasons, `${field}.reasons`),
		status: status as EvalCoverageGateSnapshot["status"],
		surfaceKey,
	} satisfies EvalCoverageGateSnapshot;
}

function normalizeSurface(value: unknown, field: string): EvalCoverageSurfaceSnapshot {
	const item = ensureObject(value, field);
	const surfaceKey = requiredString(item.surfaceKey, `${field}.surfaceKey`);
	if (!EVAL_COVERAGE_DENOMINATOR_SURFACES.includes(surfaceKey as EvalCoverageSurfaceKey)) {
		throw validationError(`${field}.surfaceKey`, `${field}.surfaceKey is unsupported.`);
	}
	const readiness = ensureObject(item.readiness, `${field}.readiness`);
	const readinessStatus = requiredString(readiness.status, `${field}.readiness.status`);
	if (!READINESS_STATUSES.has(readinessStatus)) {
		throw validationError(`${field}.readiness.status`, `${field}.readiness.status is unsupported.`);
	}
	const maturityStatus = requiredString(item.maturityStatus, `${field}.maturityStatus`);
	if (!MATURITY_STATUSES.has(maturityStatus)) {
		throw validationError(`${field}.maturityStatus`, `${field}.maturityStatus is unsupported.`);
	}
	return {
		answerQualityCaseCount: requiredNonNegativeInteger(
			item.answerQualityCaseCount,
			`${field}.answerQualityCaseCount`,
		),
		coverageGaps: requiredStringArray(item.coverageGaps, `${field}.coverageGaps`),
		goldenQrelsCaseCount: requiredNonNegativeInteger(
			item.goldenQrelsCaseCount,
			`${field}.goldenQrelsCaseCount`,
		),
		knownGapCaseCount: requiredNonNegativeInteger(
			item.knownGapCaseCount,
			`${field}.knownGapCaseCount`,
		),
		lastGate: normalizeGate(
			item.lastGate,
			`${field}.lastGate`,
			surfaceKey as EvalCoverageSurfaceKey,
		),
		maturityGaps: requiredStringArray(item.maturityGaps, `${field}.maturityGaps`),
		maturityStatus: maturityStatus as EvalCoverageSurfaceSnapshot["maturityStatus"],
		profileArtifactKind: requiredString(item.profileArtifactKind, `${field}.profileArtifactKind`),
		profileId: requiredString(item.profileId, `${field}.profileId`),
		qrelsCaseCount: requiredNonNegativeInteger(item.qrelsCaseCount, `${field}.qrelsCaseCount`),
		ragasDiagnostic: normalizeRagasDiagnostic(item.ragasDiagnostic, `${field}.ragasDiagnostic`),
		readiness: {
			reasons: requiredStringArray(readiness.reasons, `${field}.readiness.reasons`),
			status: readinessStatus as EvalCoverageSurfaceSnapshot["readiness"]["status"],
		},
		releaseAcceptanceCaseCount: requiredNonNegativeInteger(
			item.releaseAcceptanceCaseCount,
			`${field}.releaseAcceptanceCaseCount`,
		),
		surfaceKey: surfaceKey as EvalCoverageSurfaceKey,
		uniqueExpectedDocCount: requiredNonNegativeInteger(
			item.uniqueExpectedDocCount,
			`${field}.uniqueExpectedDocCount`,
		),
	};
}

export function normalizeEvalCoverageSnapshot(payload: unknown): EvalCoverageSnapshot {
	assertNoForbiddenKeys(payload);
	const item = ensureObject(payload, "payload");
	if (item.schemaVersion !== EVAL_COVERAGE_SNAPSHOT_SCHEMA_VERSION) {
		throw validationError("schemaVersion", "schemaVersion is unsupported.");
	}
	const denominatorSurfaces = assertExactCurrentSurfaces(
		item.denominatorSurfaces,
		"denominatorSurfaces",
	);
	const surfaces = requiredArray(item.surfaces, "surfaces").map((surface, index) =>
		normalizeSurface(surface, `surfaces[${index}]`),
	);
	const surfaceKeys = surfaces.map((surface) => surface.surfaceKey);
	if (
		surfaceKeys.length !== EVAL_COVERAGE_DENOMINATOR_SURFACES.length ||
		surfaceKeys.some((surface, index) => surface !== EVAL_COVERAGE_DENOMINATOR_SURFACES[index])
	) {
		throw validationError("surfaces", "surfaces must match the current RAG denominator order.");
	}
	return {
		denominatorSurfaces,
		excludedSurfaces: requiredArray(item.excludedSurfaces, "excludedSurfaces").map(
			(surface, index) => {
				const excluded = ensureObject(surface, `excludedSurfaces[${index}]`);
				return {
					reason: requiredString(excluded.reason, `excludedSurfaces[${index}].reason`),
					surfaceKey: requiredString(excluded.surfaceKey, `excludedSurfaces[${index}].surfaceKey`),
				};
			},
		),
		generatedAt: requiredIsoTimestamp(item.generatedAt, "generatedAt"),
		schemaVersion: EVAL_COVERAGE_SNAPSHOT_SCHEMA_VERSION,
		snapshotId: requiredString(item.snapshotId, "snapshotId"),
		sourceGitHead: requiredString(item.sourceGitHead, "sourceGitHead"),
		sourceReportSchema: requiredString(item.sourceReportSchema, "sourceReportSchema"),
		surfaces,
	};
}
