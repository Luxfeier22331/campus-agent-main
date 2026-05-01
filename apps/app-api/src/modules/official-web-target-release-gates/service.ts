import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import type {
	OfficialWebTargetInventoryRecord,
	OfficialWebTargetInventoryService,
} from "../official-web-target-inventory";

export type OfficialWebTargetReleaseGateDecision = "approved" | "rejected";
export type OfficialWebTargetReleaseGateStatus =
	| "approved"
	| "failed"
	| "indexed"
	| "materialized"
	| "published"
	| "rejected"
	| "running";

export interface OfficialWebTargetReleaseGateRecord {
	createdAt: string;
	decidedAt: string;
	decidedBy: string;
	decision: OfficialWebTargetReleaseGateDecision;
	errorJson: Record<string, unknown> | null;
	evidenceJson: Record<string, unknown>;
	executionJson: Record<string, unknown> | null;
	inventoryId: string;
	jobId: string;
	notes: string | null;
	publishAlias: boolean;
	releaseId: string;
	runId: string | null;
	status: OfficialWebTargetReleaseGateStatus;
	summaryId: string | null;
	updatedAt: string;
}

export interface OfficialWebTargetReleaseGateCreatePayload {
	decision?: unknown;
	notes?: unknown;
	publishAlias?: unknown;
}

export interface OfficialWebTargetReleaseGateExecutionStatusPayload {
	error?: unknown;
	execution?: unknown;
	status?: unknown;
	updatedAt?: unknown;
}

export interface OfficialWebTargetReleaseGateStore {
	getReleaseGateById(releaseId: string): Promise<OfficialWebTargetReleaseGateRecord | null>;
	updateReleaseGateExecutionStatus(input: {
		errorJson: Record<string, unknown> | null;
		executionJson: Record<string, unknown> | null;
		releaseId: string;
		status: OfficialWebTargetReleaseGateStatus;
		updatedAt: string;
	}): Promise<OfficialWebTargetReleaseGateRecord | null>;
	upsertReleaseGate(
		record: OfficialWebTargetReleaseGateRecord,
	): Promise<OfficialWebTargetReleaseGateRecord>;
}

export interface OfficialWebTargetReleaseGateService {
	createReleaseGate(input: {
		inventoryId: string;
		payload: OfficialWebTargetReleaseGateCreatePayload;
		principal: ResolvedAppPrincipal;
	}): Promise<{ releaseGate: OfficialWebTargetReleaseGateRecord }>;
	getReleaseGateById(input: {
		principal: ResolvedAppPrincipal;
		releaseId: string;
	}): Promise<{ releaseGate: OfficialWebTargetReleaseGateRecord }>;
	getReleaseGateForExecution(input: {
		releaseId: string;
	}): Promise<{ releaseGate: OfficialWebTargetReleaseGateRecord }>;
	updateReleaseGateExecutionStatus(input: {
		payload: OfficialWebTargetReleaseGateExecutionStatusPayload;
		releaseId: string;
	}): Promise<{ releaseGate: OfficialWebTargetReleaseGateRecord }>;
}

export interface OfficialWebTargetReleaseGateServiceDependencies {
	inventoryService: OfficialWebTargetInventoryService;
	now?: () => Date;
	store: OfficialWebTargetReleaseGateStore;
}

type ReleaseGateReviewableEntry = OfficialWebTargetInventoryRecord & {
	previewEvidence: NonNullable<OfficialWebTargetInventoryRecord["previewEvidence"]>;
};

const RELEASE_GATE_EXECUTION_STATUSES = new Set<OfficialWebTargetReleaseGateStatus>([
	"approved",
	"failed",
	"indexed",
	"materialized",
	"published",
	"rejected",
	"running",
]);

function ensureOperatorPrincipal(principal: ResolvedAppPrincipal): void {
	if (!principal.permissions.operator) {
		throw new AppApiRouteError({
			code: "forbidden",
			message: "Operator access is not available for this principal.",
			retryable: false,
			status: 403,
		});
	}
}

function normalizeOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDecision(value: unknown): OfficialWebTargetReleaseGateDecision {
	const normalized = normalizeOptionalString(value);
	if (normalized === "approved" || normalized === "rejected") {
		return normalized;
	}
	throw new AppApiRouteError({
		code: "validation_failed",
		details: { field: "decision" },
		message: "decision must be approved or rejected.",
		retryable: false,
		status: 422,
	});
}

function normalizeStatus(value: unknown): OfficialWebTargetReleaseGateStatus {
	const normalized = normalizeOptionalString(value);
	if (
		normalized &&
		RELEASE_GATE_EXECUTION_STATUSES.has(normalized as OfficialWebTargetReleaseGateStatus)
	) {
		return normalized as OfficialWebTargetReleaseGateStatus;
	}
	throw new AppApiRouteError({
		code: "validation_failed",
		details: { field: "status" },
		message:
			"status must be one of: approved, rejected, running, materialized, indexed, published, failed.",
		retryable: false,
		status: 422,
	});
}

function normalizeUpdatedAt(value: unknown, fallbackNow: Date): string {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return fallbackNow.toISOString();
	}
	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.valueOf())) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "updatedAt" },
			message: "updatedAt must be a valid ISO timestamp.",
			retryable: false,
			status: 422,
		});
	}
	return parsed.toISOString();
}

function normalizeRecordJson(value: unknown, fieldName: string): Record<string, unknown> | null {
	if (value == null) {
		return null;
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	throw new AppApiRouteError({
		code: "validation_failed",
		details: { field: fieldName },
		message: `${fieldName} must be an object when provided.`,
		retryable: false,
		status: 422,
	});
}

function sanitizeIdPart(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function buildReleaseId(input: { inventoryId: string; runId: string }): string {
	return `owrelease_${sanitizeIdPart(input.inventoryId)}_${sanitizeIdPart(input.runId)}`;
}

function assertStableReferenceReleaseGateEntry(entry: OfficialWebTargetInventoryRecord): void {
	if (
		entry.consumerFamily !== "stable_reference_candidate" ||
		entry.selectedWriteTarget !== "official_web/stable_reference"
	) {
		throw new AppApiRouteError({
			code: "release_gate_not_supported",
			details: {
				consumerFamily: entry.consumerFamily,
				selectedWriteTarget: entry.selectedWriteTarget,
			},
			message: "Only stable reference target inventory entries can use this release gate.",
			retryable: false,
			status: 409,
		});
	}
}

function assertReviewableReleaseGateEntry(
	entry: OfficialWebTargetInventoryRecord,
): asserts entry is ReleaseGateReviewableEntry {
	if (!entry.previewEvidence) {
		throw new AppApiRouteError({
			code: "release_gate_not_ready",
			details: { blockers: ["missing_preview_evidence"] },
			message: "Stable reference target inventory entry has no preview evidence to review.",
			retryable: false,
			status: 409,
		});
	}
}

function findApprovalBlockers(entry: OfficialWebTargetInventoryRecord): string[] {
	const blockers: string[] = [];
	const evidence = entry.previewEvidence;
	if (entry.reviewState !== "previewed") {
		blockers.push(`review_state_${entry.reviewState}`);
	}
	if (evidence) {
		if (evidence.ingestionStatus !== "staged") {
			blockers.push("ingestion_not_staged");
		}
		if (evidence.promotionDecision !== "staged") {
			blockers.push("promotion_not_staged");
		}
		if (!evidence.currentTruthImportWasNull) {
			blockers.push("current_truth_import_present");
		}
		if (evidence.sourceObjectKeys.length === 0) {
			blockers.push("missing_source_object_keys");
		}
	} else {
		blockers.push("missing_preview_evidence");
	}
	for (const fieldName of entry.requiredFields) {
		if (entry.fieldStatus[fieldName] !== "present") {
			blockers.push(`missing_${fieldName}`);
		}
	}
	return blockers;
}

function assertApprovalReady(entry: OfficialWebTargetInventoryRecord): void {
	const blockers = findApprovalBlockers(entry);
	if (blockers.length > 0) {
		throw new AppApiRouteError({
			code: "release_gate_not_ready",
			details: { blockers },
			message: "Stable reference target inventory entry is not ready for release approval.",
			retryable: false,
			status: 409,
		});
	}
}

function buildReleaseEvidence(entry: ReleaseGateReviewableEntry): Record<string, unknown> {
	return {
		admissionTargetId: entry.admissionTargetId,
		consumerFamily: entry.consumerFamily,
		fieldStatus: entry.fieldStatus,
		inventoryId: entry.inventoryId,
		ownerSurface: entry.ownerSurface,
		previewEvidence: entry.previewEvidence,
		releaseBlockers: entry.releaseBlockers,
		requiredFields: entry.requiredFields,
		reviewState: entry.reviewState,
		selectedWriteTarget: entry.selectedWriteTarget,
		sourceObjectKeys: entry.previewEvidence.sourceObjectKeys,
		sourceUrls: entry.sourceUrls,
		targetAttemptId: entry.previewEvidence.targetAttemptId,
		targetJobId: entry.previewEvidence.targetJobId,
		targetLabel: entry.targetLabel,
	};
}

function resolveDecidedBy(principal: ResolvedAppPrincipal): string {
	return (
		principal.principal.email ??
		principal.principal.principalId ??
		principal.actor.principalId ??
		"unknown_operator"
	);
}

function notFound(releaseId: string): AppApiRouteError {
	return new AppApiRouteError({
		code: "release_gate_not_found",
		details: { releaseId },
		message: "Official web target release gate not found.",
		retryable: false,
		status: 404,
	});
}

export function buildOfficialWebTargetReleaseGateService(
	dependencies: OfficialWebTargetReleaseGateServiceDependencies,
): OfficialWebTargetReleaseGateService {
	const now = dependencies.now ?? (() => new Date());

	return {
		async createReleaseGate(input) {
			ensureOperatorPrincipal(input.principal);
			const inventoryId = normalizeOptionalString(input.inventoryId);
			if (!inventoryId) {
				throw new AppApiRouteError({
					code: "target_inventory_not_found",
					message: "Official web target inventory entry not found.",
					retryable: false,
					status: 404,
				});
			}
			const decision = normalizeDecision(input.payload.decision);
			const entry = await dependencies.inventoryService.getTargetInventoryEntryById({
				inventoryId,
				principal: input.principal,
			});
			assertStableReferenceReleaseGateEntry(entry);
			assertReviewableReleaseGateEntry(entry);
			if (decision === "approved") {
				assertApprovalReady(entry);
			}

			const previewEvidence = entry.previewEvidence;
			const timestamp = now().toISOString();
			const releaseGate = await dependencies.store.upsertReleaseGate({
				createdAt: timestamp,
				decidedAt: timestamp,
				decidedBy: resolveDecidedBy(input.principal),
				decision,
				errorJson: null,
				evidenceJson: buildReleaseEvidence(entry),
				executionJson: null,
				inventoryId: entry.inventoryId,
				jobId: previewEvidence.targetJobId,
				notes: normalizeOptionalString(input.payload.notes),
				publishAlias: input.payload.publishAlias === true,
				releaseId: buildReleaseId({
					inventoryId: entry.inventoryId,
					runId: previewEvidence.appApiRunId,
				}),
				runId: previewEvidence.appApiRunId,
				status: decision,
				summaryId: null,
				updatedAt: timestamp,
			});

			return { releaseGate };
		},

		async getReleaseGateById(input) {
			ensureOperatorPrincipal(input.principal);
			const releaseId = normalizeOptionalString(input.releaseId);
			if (!releaseId) {
				throw notFound("");
			}
			const releaseGate = await dependencies.store.getReleaseGateById(releaseId);
			if (!releaseGate) {
				throw notFound(releaseId);
			}
			return { releaseGate };
		},

		async getReleaseGateForExecution(input) {
			const releaseId = normalizeOptionalString(input.releaseId);
			if (!releaseId) {
				throw notFound("");
			}
			const releaseGate = await dependencies.store.getReleaseGateById(releaseId);
			if (!releaseGate) {
				throw notFound(releaseId);
			}
			return { releaseGate };
		},

		async updateReleaseGateExecutionStatus(input) {
			const releaseId = normalizeOptionalString(input.releaseId);
			if (!releaseId) {
				throw notFound("");
			}
			const status = normalizeStatus(input.payload.status);
			const updatedAt = normalizeUpdatedAt(input.payload.updatedAt, now());
			const releaseGate = await dependencies.store.updateReleaseGateExecutionStatus({
				errorJson: normalizeRecordJson(input.payload.error, "error"),
				executionJson: normalizeRecordJson(input.payload.execution, "execution"),
				releaseId,
				status,
				updatedAt,
			});
			if (!releaseGate) {
				throw notFound(releaseId);
			}
			return { releaseGate };
		},
	};
}
