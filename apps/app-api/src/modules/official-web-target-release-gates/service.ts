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
	| "pending"
	| "rejected";

export interface OfficialWebTargetReleaseGateRecord {
	createdAt?: string;
	decidedAt: string;
	decidedBy: string;
	decision: OfficialWebTargetReleaseGateDecision | string;
	errorJson?: Record<string, unknown> | null;
	evidenceJson?: Record<string, unknown>;
	executionJson?: Record<string, unknown> | null;
	inventoryId: string;
	jobId: string;
	notes: string | null;
	publishAlias: boolean;
	releaseId: string;
	runId: string | null;
	status: OfficialWebTargetReleaseGateStatus | string;
	summaryId: string | null;
	updatedAt?: string;
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
		status: string;
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
		releaseId: string;
		principal: ResolvedAppPrincipal;
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
	const normalized = typeof value === "string" ? value.trim() : "";
	return normalized ? normalized : null;
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function sanitizeIdPart(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function normalizeDecision(value: unknown): OfficialWebTargetReleaseGateDecision {
	const decision = normalizeOptionalString(value);
	if (decision === "approved" || decision === "rejected") {
		return decision;
	}
	throw new AppApiRouteError({
		code: "validation_failed",
		details: { field: "decision" },
		message: "decision must be approved or rejected.",
		retryable: false,
		status: 422,
	});
}

function ensureReleaseGateReady(entry: OfficialWebTargetInventoryRecord): void {
	if (
		entry.reviewState !== "previewed" ||
		!entry.previewEvidence ||
		!entry.releaseBlockers.includes("release_gate_not_reviewed")
	) {
		throw new AppApiRouteError({
			code: "release_gate_not_ready",
			message: "Official web target is not ready for release gate review.",
			retryable: false,
			status: 409,
		});
	}
}

function buildReleaseId(input: { inventoryId: string; runId: string }): string {
	return `owrelease_${sanitizeIdPart(input.inventoryId)}_${sanitizeIdPart(input.runId)}`;
}

function decidedBy(principal: ResolvedAppPrincipal): string {
	return (
		normalizeOptionalString(principal.actor.principalId) ??
		normalizeOptionalString(principal.principal.email) ??
		principal.principal.principalId
	);
}

function evidenceFromEntry(entry: OfficialWebTargetInventoryRecord): Record<string, unknown> {
	return {
		admissionTargetId: entry.admissionTargetId,
		fieldStatus: entry.fieldStatus,
		inventoryId: entry.inventoryId,
		releaseBlockers: entry.releaseBlockers,
		requiredFields: entry.requiredFields,
		reviewState: entry.reviewState,
		selectedWriteTarget: entry.selectedWriteTarget,
		sourceObjectKeys: entry.previewEvidence?.sourceObjectKeys ?? [],
		sourceUrls: entry.sourceUrls,
		targetLabel: entry.targetLabel,
	};
}

function normalizeStatus(value: unknown): string {
	const status = normalizeOptionalString(value);
	if (!status) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "status" },
			message: "status is required.",
			retryable: false,
			status: 422,
		});
	}
	return status;
}

function normalizeUpdatedAt(value: unknown, fallbackNow: Date): string {
	const timestamp = normalizeOptionalString(value);
	if (!timestamp) {
		return fallbackNow.toISOString();
	}
	const parsed = new Date(timestamp);
	if (Number.isNaN(parsed.getTime())) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "updatedAt" },
			message: "updatedAt must be an ISO timestamp.",
			retryable: false,
			status: 422,
		});
	}
	return parsed.toISOString();
}

function releaseGateNotFound(): AppApiRouteError {
	return new AppApiRouteError({
		code: "release_gate_not_found",
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
					message: "Official web target inventory row not found.",
					retryable: false,
					status: 404,
				});
			}
			const entry = await dependencies.inventoryService.getTargetInventoryEntryById({
				inventoryId,
				principal: input.principal,
			});
			const decision = normalizeDecision(input.payload.decision);
			if (decision === "approved") {
				ensureReleaseGateReady(entry);
			}
			const timestamp = now().toISOString();
			const preview = entry.previewEvidence;
			const releaseGate = await dependencies.store.upsertReleaseGate({
				decidedAt: timestamp,
				decidedBy: decidedBy(input.principal),
				decision,
				errorJson: null,
				evidenceJson: evidenceFromEntry(entry),
				executionJson: null,
				inventoryId: entry.inventoryId,
				jobId: preview?.targetJobId ?? entry.admissionTargetId,
				notes: normalizeOptionalString(input.payload.notes),
				publishAlias: input.payload.publishAlias === true,
				releaseId: buildReleaseId({
					inventoryId: entry.inventoryId,
					runId: preview?.appApiRunId ?? timestamp,
				}),
				runId: preview?.appApiRunId ?? null,
				status: decision,
				summaryId: null,
			});
			return { releaseGate };
		},

		async getReleaseGateById(input) {
			ensureOperatorPrincipal(input.principal);
			const releaseId = normalizeOptionalString(input.releaseId);
			const releaseGate = releaseId ? await dependencies.store.getReleaseGateById(releaseId) : null;
			if (!releaseGate) {
				throw releaseGateNotFound();
			}
			return { releaseGate };
		},

		async getReleaseGateForExecution(input) {
			const releaseId = normalizeOptionalString(input.releaseId);
			const releaseGate = releaseId ? await dependencies.store.getReleaseGateById(releaseId) : null;
			if (!releaseGate) {
				throw releaseGateNotFound();
			}
			return { releaseGate };
		},

		async updateReleaseGateExecutionStatus(input) {
			const releaseId = normalizeOptionalString(input.releaseId);
			if (!releaseId) {
				throw releaseGateNotFound();
			}
			const releaseGate = await dependencies.store.updateReleaseGateExecutionStatus({
				errorJson: normalizeRecord(input.payload.error),
				executionJson: normalizeRecord(input.payload.execution),
				releaseId,
				status: normalizeStatus(input.payload.status),
				updatedAt: normalizeUpdatedAt(input.payload.updatedAt, now()),
			});
			if (!releaseGate) {
				throw releaseGateNotFound();
			}
			return { releaseGate };
		},
	};
}
