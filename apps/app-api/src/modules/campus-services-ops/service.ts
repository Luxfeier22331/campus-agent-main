import { randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import type { CampusServicesOpsStore } from "./store";
import type {
	CampusServicesOpsActor,
	CampusServicesOpsAuditEvent,
	CampusServicesOpsCreateTransportOverridePayload,
	CampusServicesOpsCurrentEffectiveSnapshot,
	CampusServicesOpsDiffSummary,
	CampusServicesOpsOverrideReviewState,
	CampusServicesOpsRelease,
	CampusServicesOpsReleasePayload,
	CampusServicesOpsReleasePreview,
	CampusServicesOpsService,
	CampusServicesOpsSourceAttestation,
	CampusServicesOpsSourceType,
	CampusServicesOpsTransportOverride,
	CampusServicesOpsTransportStatus,
} from "./types";

export interface CampusServicesOpsServiceDependencies {
	generateId?: (prefix: string) => string;
	now?: () => Date;
	store: CampusServicesOpsStore;
}

const SOURCE_TYPES = new Set<CampusServicesOpsSourceType>([
	"authenticated_notice_candidate",
	"counselor_notice",
	"group_message",
	"official_web_candidate",
	"onsite_confirmation",
	"operator_curated",
	"phone_confirmation",
]);
const TRANSPORT_STATUSES = new Set<CampusServicesOpsTransportStatus>([
	"delayed",
	"extra_service",
	"normal",
	"rerouted",
	"suspended",
	"temporarily_unavailable",
]);
const REVIEW_STATES = new Set<CampusServicesOpsOverrideReviewState>([
	"archived",
	"draft",
	"published",
	"ready_for_publish",
]);

function defaultGenerateId(prefix: string): string {
	return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function routeError(input: {
	code: string;
	details?: unknown;
	message: string;
	status: number;
}): AppApiRouteError {
	return new AppApiRouteError({
		code: input.code,
		details: input.details,
		message: input.message,
		retryable: false,
		status: input.status,
	});
}

function validationError(message: string, details?: unknown): AppApiRouteError {
	return routeError({
		code: "validation_failed",
		details,
		message,
		status: 422,
	});
}

function ensureOperatorPrincipal(principal: ResolvedAppPrincipal): CampusServicesOpsActor {
	if (!principal.permissions.operator) {
		throw routeError({
			code: "forbidden",
			message: "Operator access is not available for this principal.",
			status: 403,
		});
	}
	const principalId = principal.principal.principalId.trim();
	if (!principalId) {
		throw routeError({
			code: "invalid_principal",
			message: "Campus services ops requires a stable operator principal id.",
			status: 403,
		});
	}
	return {
		displayName: principal.principal.displayName.trim() || principalId,
		principalId,
	};
}

function normalizeRequiredString(input: {
	field: string;
	maxLength?: number;
	value: unknown;
}): string {
	if (typeof input.value !== "string") {
		throw validationError(`${input.field} must be a string.`, { field: input.field });
	}
	const normalized = input.value.trim();
	if (!normalized) {
		throw validationError(`${input.field} is required.`, { field: input.field });
	}
	const maxLength = input.maxLength ?? 300;
	if (normalized.length > maxLength) {
		throw validationError(`${input.field} is too long.`, { field: input.field, maxLength });
	}
	return normalized;
}

function normalizeOptionalString(input: {
	field: string;
	maxLength?: number;
	value: unknown;
}): string | null {
	if (input.value == null) {
		return null;
	}
	return normalizeRequiredString(input);
}

function normalizeTimestamp(value: unknown, field: string): string {
	if (typeof value !== "string") {
		throw validationError(`${field} must be an ISO timestamp.`, { field });
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.valueOf())) {
		throw validationError(`${field} must be an ISO timestamp.`, { field });
	}
	return parsed.toISOString();
}

function assertEffectiveWindow(input: { effectiveFrom: string; effectiveUntil: string }): void {
	if (new Date(input.effectiveUntil).getTime() <= new Date(input.effectiveFrom).getTime()) {
		throw validationError("effectiveUntil must be later than effectiveFrom.", {
			field: "effectiveUntil",
		});
	}
}

function normalizeStringArray(value: unknown, field: string): string[] {
	if (value == null) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw validationError(`${field} must be an array of strings.`, { field });
	}
	const normalized = value.map((item, index) => {
		if (typeof item !== "string" || !item.trim()) {
			throw validationError(`${field}[${index}] must be a non-empty string.`, { field });
		}
		return item.trim();
	});
	return [...new Set(normalized)];
}

function normalizeSourceType(value: unknown): CampusServicesOpsSourceType {
	const normalized = normalizeRequiredString({ field: "sourceType", value });
	if (!SOURCE_TYPES.has(normalized as CampusServicesOpsSourceType)) {
		throw validationError("sourceType is not supported.", { field: "sourceType" });
	}
	return normalized as CampusServicesOpsSourceType;
}

function normalizeTransportStatus(value: unknown): CampusServicesOpsTransportStatus {
	const normalized = normalizeRequiredString({ field: "serviceStatus", value });
	if (!TRANSPORT_STATUSES.has(normalized as CampusServicesOpsTransportStatus)) {
		throw validationError("serviceStatus is not supported.", { field: "serviceStatus" });
	}
	return normalized as CampusServicesOpsTransportStatus;
}

function normalizeReviewState(value: unknown): CampusServicesOpsOverrideReviewState {
	const normalized = normalizeRequiredString({ field: "reviewState", value });
	if (!REVIEW_STATES.has(normalized as CampusServicesOpsOverrideReviewState)) {
		throw validationError("reviewState is not supported.", { field: "reviewState" });
	}
	return normalized as CampusServicesOpsOverrideReviewState;
}

function sanitizeAttestationForAudit(
	attestation: CampusServicesOpsSourceAttestation,
): Record<string, unknown> {
	return {
		attestationId: attestation.attestationId,
		confirmedAt: attestation.confirmedAt,
		sourceType: attestation.sourceType,
		status: attestation.status,
		summary: attestation.summary,
	};
}

function sanitizeTransportOverrideForAudit(
	override: CampusServicesOpsTransportOverride,
): Record<string, unknown> {
	return {
		effectiveFrom: override.effectiveFrom,
		effectiveUntil: override.effectiveUntil,
		overrideId: override.overrideId,
		reviewState: override.reviewState,
		routeId: override.routeId,
		serviceStatus: override.serviceStatus,
		sourceAttestationIds: override.sourceAttestationIds,
	};
}

function buildAuditEvent(input: {
	action: string;
	actor: CampusServicesOpsActor;
	after: Record<string, unknown> | null;
	before: Record<string, unknown> | null;
	generateId: (prefix: string) => string;
	objectId: string;
	objectType: string;
	occurredAt: string;
	summary: string;
}): CampusServicesOpsAuditEvent {
	return {
		action: input.action,
		actor: input.actor,
		after: input.after,
		auditEventId: input.generateId("services_audit"),
		before: input.before,
		objectId: input.objectId,
		objectType: input.objectType,
		occurredAt: input.occurredAt,
		summary: input.summary,
	};
}

async function assertAttestationsExist(
	store: CampusServicesOpsStore,
	sourceAttestationIds: string[],
): Promise<void> {
	if (sourceAttestationIds.length === 0) {
		return;
	}
	if (!(await store.attestationIdsExist(sourceAttestationIds))) {
		throw validationError("sourceAttestationIds contains unknown attestations.", {
			field: "sourceAttestationIds",
		});
	}
}

function normalizeTransportOverridePayload(
	payload: CampusServicesOpsCreateTransportOverridePayload,
): Pick<
	CampusServicesOpsTransportOverride,
	| "displayName"
	| "effectiveFrom"
	| "effectiveUntil"
	| "message"
	| "routeId"
	| "serviceStatus"
	| "sourceAttestationIds"
> {
	const effectiveFrom = normalizeTimestamp(payload.effectiveFrom, "effectiveFrom");
	const effectiveUntil = normalizeTimestamp(payload.effectiveUntil, "effectiveUntil");
	assertEffectiveWindow({ effectiveFrom, effectiveUntil });
	return {
		displayName: normalizeRequiredString({
			field: "displayName",
			maxLength: 160,
			value: payload.displayName,
		}),
		effectiveFrom,
		effectiveUntil,
		message: normalizeRequiredString({ field: "message", maxLength: 500, value: payload.message }),
		routeId: normalizeRequiredString({ field: "routeId", maxLength: 160, value: payload.routeId }),
		serviceStatus: normalizeTransportStatus(payload.serviceStatus),
		sourceAttestationIds: normalizeStringArray(
			payload.sourceAttestationIds,
			"sourceAttestationIds",
		),
	};
}

function normalizeReleaseNotes(payload: CampusServicesOpsReleasePayload): string | null {
	return normalizeOptionalString({ field: "notes", maxLength: 1000, value: payload.notes });
}

function itemKey(kind: "transport", id: string): string {
	return `${kind}:${id}`;
}

function calculateDiff(input: {
	current: CampusServicesOpsCurrentEffectiveSnapshot;
	previous: CampusServicesOpsCurrentEffectiveSnapshot | null;
}): CampusServicesOpsDiffSummary {
	const previousKeys = new Set<string>();
	for (const override of input.previous?.transportOverrides ?? []) {
		previousKeys.add(itemKey("transport", override.overrideId));
	}
	const currentKeys = new Set<string>();
	for (const override of input.current.transportOverrides) {
		currentKeys.add(itemKey("transport", override.overrideId));
	}
	return {
		added: [...currentKeys].filter((key) => !previousKeys.has(key)).sort(),
		removed: [...previousKeys].filter((key) => !currentKeys.has(key)).sort(),
		unchanged: [...currentKeys].filter((key) => previousKeys.has(key)).sort(),
	};
}

function isCurrentEffective(input: {
	effectiveFrom: string;
	effectiveUntil: string;
	nowMs: number;
	reviewState: CampusServicesOpsOverrideReviewState;
}): boolean {
	return (
		input.reviewState === "ready_for_publish" &&
		new Date(input.effectiveFrom).getTime() <= input.nowMs &&
		new Date(input.effectiveUntil).getTime() > input.nowMs
	);
}

async function buildCurrentEffectiveSnapshot(
	store: CampusServicesOpsStore,
	generatedAt: string,
): Promise<CampusServicesOpsCurrentEffectiveSnapshot> {
	const nowMs = new Date(generatedAt).getTime();
	const transportOverrides = (await store.listTransportOverrides()).filter((override) =>
		isCurrentEffective({
			effectiveFrom: override.effectiveFrom,
			effectiveUntil: override.effectiveUntil,
			nowMs,
			reviewState: override.reviewState,
		}),
	);
	return {
		generatedAt,
		transportOverrides,
	};
}

async function buildReleasePreview(input: {
	generatedAt: string;
	notes: string | null;
	store: CampusServicesOpsStore;
}): Promise<CampusServicesOpsReleasePreview> {
	const currentEffective = await buildCurrentEffectiveSnapshot(input.store, input.generatedAt);
	const latestRelease = await input.store.getLatestRelease();
	const itemCount = currentEffective.transportOverrides.length;
	return {
		currentEffective,
		diff: calculateDiff({
			current: currentEffective,
			previous: latestRelease?.currentEffective ?? null,
		}),
		generatedAt: input.generatedAt,
		itemCount,
		notes: input.notes,
		warnings: [],
	};
}

export function buildCampusServicesOpsService(
	dependencies: CampusServicesOpsServiceDependencies,
): CampusServicesOpsService {
	const generateId = dependencies.generateId ?? defaultGenerateId;
	const now = dependencies.now ?? (() => new Date());

	return {
		async createAttestation(input) {
			const actor = ensureOperatorPrincipal(input.principal);
			const occurredAt = now().toISOString();
			const attestation: CampusServicesOpsSourceAttestation = {
				attestationId: generateId("services_attestation"),
				confirmedAt: normalizeTimestamp(input.payload.confirmedAt, "confirmedAt"),
				createdAt: occurredAt,
				createdBy: actor,
				operatorNotes: normalizeOptionalString({
					field: "operatorNotes",
					maxLength: 1000,
					value: input.payload.operatorNotes,
				}),
				sourceType: normalizeSourceType(input.payload.sourceType),
				status: "active",
				summary: normalizeRequiredString({
					field: "summary",
					maxLength: 1000,
					value: input.payload.summary,
				}),
			};
			await dependencies.store.createAttestation({
				attestation,
				auditEvent: buildAuditEvent({
					action: "attestation.created",
					actor,
					after: sanitizeAttestationForAudit(attestation),
					before: null,
					generateId,
					objectId: attestation.attestationId,
					objectType: "source_attestation",
					occurredAt,
					summary: "Campus services source attestation created.",
				}),
			});
			return { attestation };
		},

		async createTransportOverride(input) {
			const actor = ensureOperatorPrincipal(input.principal);
			const normalized = normalizeTransportOverridePayload(input.payload);
			await assertAttestationsExist(dependencies.store, normalized.sourceAttestationIds);
			const occurredAt = now().toISOString();
			const override: CampusServicesOpsTransportOverride = {
				...normalized,
				createdAt: occurredAt,
				createdBy: actor,
				overrideId: generateId("services_transport_override"),
				reviewState: "ready_for_publish",
				updatedAt: occurredAt,
				updatedBy: actor,
			};
			await dependencies.store.createTransportOverride({
				auditEvent: buildAuditEvent({
					action: "transport_override.created",
					actor,
					after: sanitizeTransportOverrideForAudit(override),
					before: null,
					generateId,
					objectId: override.overrideId,
					objectType: "transport_schedule_override",
					occurredAt,
					summary: "Campus services transport override created.",
				}),
				override,
			});
			return { override };
		},

		async listAuditEvents(input) {
			ensureOperatorPrincipal(input.principal);
			return { auditEvents: await dependencies.store.listAuditEvents() };
		},

		async listCandidates(input) {
			ensureOperatorPrincipal(input.principal);
			return {
				attestations: await dependencies.store.listAttestations(),
				transportOverrides: await dependencies.store.listTransportOverrides(),
			};
		},

		async listReleases(input) {
			ensureOperatorPrincipal(input.principal);
			return { releases: await dependencies.store.listReleases() };
		},

		async listTransportOverrides(input) {
			ensureOperatorPrincipal(input.principal);
			return { overrides: await dependencies.store.listTransportOverrides() };
		},

		async previewRelease(input) {
			ensureOperatorPrincipal(input.principal);
			const generatedAt = now().toISOString();
			const notes = normalizeReleaseNotes(input.payload);
			return {
				preview: await buildReleasePreview({
					generatedAt,
					notes,
					store: dependencies.store,
				}),
			};
		},

		async publishRelease(input) {
			const actor = ensureOperatorPrincipal(input.principal);
			const publishedAt = now().toISOString();
			const notes = normalizeReleaseNotes(input.payload);
			const preview = await buildReleasePreview({
				generatedAt: publishedAt,
				notes,
				store: dependencies.store,
			});
			const release: CampusServicesOpsRelease = {
				createdAt: publishedAt,
				createdBy: actor,
				currentEffective: preview.currentEffective,
				itemCount: preview.itemCount,
				notes,
				publishedAt,
				publishedBy: actor,
				releaseId: generateId("services_release"),
				status: "published",
			};
			await dependencies.store.publishRelease({
				auditEvent: buildAuditEvent({
					action: "release.published",
					actor,
					after: {
						itemCount: release.itemCount,
						releaseId: release.releaseId,
					},
					before: null,
					generateId,
					objectId: release.releaseId,
					objectType: "campus_services_release",
					occurredAt: publishedAt,
					summary: "Campus services current-effective release published.",
				}),
				release,
			});
			return {
				currentEffective: preview.currentEffective,
				diff: preview.diff,
				release,
			};
		},

		async updateTransportOverride(input) {
			const actor = ensureOperatorPrincipal(input.principal);
			const existing = await dependencies.store.getTransportOverride(input.overrideId.trim());
			if (!existing) {
				throw routeError({
					code: "transport_override_not_found",
					message: "Campus services transport override not found.",
					status: 404,
				});
			}
			const mergedPayload = { ...existing, ...input.payload };
			const normalized = normalizeTransportOverridePayload(mergedPayload);
			await assertAttestationsExist(dependencies.store, normalized.sourceAttestationIds);
			const occurredAt = now().toISOString();
			const override: CampusServicesOpsTransportOverride = {
				...existing,
				...normalized,
				reviewState:
					input.payload.reviewState == null
						? existing.reviewState
						: normalizeReviewState(input.payload.reviewState),
				updatedAt: occurredAt,
				updatedBy: actor,
			};
			await dependencies.store.updateTransportOverride({
				auditEvent: buildAuditEvent({
					action: "transport_override.updated",
					actor,
					after: sanitizeTransportOverrideForAudit(override),
					before: sanitizeTransportOverrideForAudit(existing),
					generateId,
					objectId: override.overrideId,
					objectType: "transport_schedule_override",
					occurredAt,
					summary: "Campus services transport override updated.",
				}),
				override,
			});
			return { override };
		},
	};
}
