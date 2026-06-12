import type { ResolvedAppPrincipal } from "../auth";

export type CampusServicesOpsSourceType =
	| "authenticated_notice_candidate"
	| "counselor_notice"
	| "group_message"
	| "official_web_candidate"
	| "onsite_confirmation"
	| "operator_curated"
	| "phone_confirmation";

export type CampusServicesOpsAttestationStatus = "active" | "superseded" | "rejected";
export type CampusServicesOpsOverrideReviewState =
	| "archived"
	| "draft"
	| "published"
	| "ready_for_publish";
export type CampusServicesOpsServiceStatus =
	| "closed"
	| "limited"
	| "open"
	| "temporarily_unavailable";
export type CampusServicesOpsTransportStatus =
	| "delayed"
	| "extra_service"
	| "normal"
	| "rerouted"
	| "suspended"
	| "temporarily_unavailable";

export interface CampusServicesOpsActor {
	displayName: string;
	principalId: string;
}

export interface CampusServicesOpsSourceAttestation {
	attestationId: string;
	confirmedAt: string;
	createdAt: string;
	createdBy: CampusServicesOpsActor;
	operatorNotes: string | null;
	sourceType: CampusServicesOpsSourceType;
	status: CampusServicesOpsAttestationStatus;
	summary: string;
}

export interface CampusServicesOpsStatusOverride {
	createdAt: string;
	createdBy: CampusServicesOpsActor;
	displayName: string;
	effectiveFrom: string;
	effectiveUntil: string;
	message: string;
	overrideId: string;
	reviewState: CampusServicesOpsOverrideReviewState;
	serviceId: string;
	sourceAttestationIds: string[];
	status: CampusServicesOpsServiceStatus;
	updatedAt: string;
	updatedBy: CampusServicesOpsActor;
}

export interface CampusServicesOpsTransportOverride {
	createdAt: string;
	createdBy: CampusServicesOpsActor;
	displayName: string;
	effectiveFrom: string;
	effectiveUntil: string;
	message: string;
	overrideId: string;
	reviewState: CampusServicesOpsOverrideReviewState;
	routeId: string;
	serviceStatus: CampusServicesOpsTransportStatus;
	sourceAttestationIds: string[];
	updatedAt: string;
	updatedBy: CampusServicesOpsActor;
}

export interface CampusServicesOpsCurrentEffectiveSnapshot {
	generatedAt: string;
	statusOverrides: CampusServicesOpsStatusOverride[];
	transportOverrides: CampusServicesOpsTransportOverride[];
}

export interface CampusServicesOpsRelease {
	createdAt: string;
	createdBy: CampusServicesOpsActor;
	currentEffective: CampusServicesOpsCurrentEffectiveSnapshot;
	itemCount: number;
	notes: string | null;
	publishedAt: string;
	publishedBy: CampusServicesOpsActor;
	releaseId: string;
	status: "published";
}

export interface CampusServicesOpsAuditEvent {
	action: string;
	actor: CampusServicesOpsActor;
	after: Record<string, unknown> | null;
	auditEventId: string;
	before: Record<string, unknown> | null;
	objectId: string;
	objectType: string;
	occurredAt: string;
	summary: string;
}

export interface CampusServicesOpsDiffSummary {
	added: string[];
	removed: string[];
	unchanged: string[];
}

export interface CampusServicesOpsReleasePreview {
	currentEffective: CampusServicesOpsCurrentEffectiveSnapshot;
	diff: CampusServicesOpsDiffSummary;
	generatedAt: string;
	itemCount: number;
	notes: string | null;
	warnings: string[];
}

export interface CampusServicesOpsCreateAttestationPayload {
	confirmedAt?: unknown;
	operatorNotes?: unknown;
	sourceType?: unknown;
	summary?: unknown;
}

export interface CampusServicesOpsCreateStatusOverridePayload {
	displayName?: unknown;
	effectiveFrom?: unknown;
	effectiveUntil?: unknown;
	message?: unknown;
	serviceId?: unknown;
	sourceAttestationIds?: unknown;
	status?: unknown;
}

export interface CampusServicesOpsUpdateStatusOverridePayload
	extends Partial<CampusServicesOpsCreateStatusOverridePayload> {
	reviewState?: unknown;
}

export interface CampusServicesOpsCreateTransportOverridePayload {
	displayName?: unknown;
	effectiveFrom?: unknown;
	effectiveUntil?: unknown;
	message?: unknown;
	routeId?: unknown;
	serviceStatus?: unknown;
	sourceAttestationIds?: unknown;
}

export interface CampusServicesOpsUpdateTransportOverridePayload
	extends Partial<CampusServicesOpsCreateTransportOverridePayload> {
	reviewState?: unknown;
}

export interface CampusServicesOpsReleasePayload {
	notes?: unknown;
}

export interface CampusServicesOpsService {
	createAttestation(input: {
		payload: CampusServicesOpsCreateAttestationPayload;
		principal: ResolvedAppPrincipal;
	}): Promise<{ attestation: CampusServicesOpsSourceAttestation }>;
	createStatusOverride(input: {
		payload: CampusServicesOpsCreateStatusOverridePayload;
		principal: ResolvedAppPrincipal;
	}): Promise<{ override: CampusServicesOpsStatusOverride }>;
	createTransportOverride(input: {
		payload: CampusServicesOpsCreateTransportOverridePayload;
		principal: ResolvedAppPrincipal;
	}): Promise<{ override: CampusServicesOpsTransportOverride }>;
	listAuditEvents(input: {
		principal: ResolvedAppPrincipal;
	}): Promise<{ auditEvents: CampusServicesOpsAuditEvent[] }>;
	listCandidates(input: { principal: ResolvedAppPrincipal }): Promise<{
		attestations: CampusServicesOpsSourceAttestation[];
		statusOverrides: CampusServicesOpsStatusOverride[];
		transportOverrides: CampusServicesOpsTransportOverride[];
	}>;
	listReleases(input: {
		principal: ResolvedAppPrincipal;
	}): Promise<{ releases: CampusServicesOpsRelease[] }>;
	listStatusOverrides(input: {
		principal: ResolvedAppPrincipal;
	}): Promise<{ overrides: CampusServicesOpsStatusOverride[] }>;
	listTransportOverrides(input: {
		principal: ResolvedAppPrincipal;
	}): Promise<{ overrides: CampusServicesOpsTransportOverride[] }>;
	previewRelease(input: {
		payload: CampusServicesOpsReleasePayload;
		principal: ResolvedAppPrincipal;
	}): Promise<{ preview: CampusServicesOpsReleasePreview }>;
	publishRelease(input: {
		payload: CampusServicesOpsReleasePayload;
		principal: ResolvedAppPrincipal;
	}): Promise<{
		currentEffective: CampusServicesOpsCurrentEffectiveSnapshot;
		diff: CampusServicesOpsDiffSummary;
		release: CampusServicesOpsRelease;
	}>;
	updateStatusOverride(input: {
		overrideId: string;
		payload: CampusServicesOpsUpdateStatusOverridePayload;
		principal: ResolvedAppPrincipal;
	}): Promise<{ override: CampusServicesOpsStatusOverride }>;
	updateTransportOverride(input: {
		overrideId: string;
		payload: CampusServicesOpsUpdateTransportOverridePayload;
		principal: ResolvedAppPrincipal;
	}): Promise<{ override: CampusServicesOpsTransportOverride }>;
}
