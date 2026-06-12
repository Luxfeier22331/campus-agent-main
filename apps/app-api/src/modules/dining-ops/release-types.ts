import type { DiningPublishedSnapshot } from "./types";

export type DiningReleaseCandidateStatus =
	| "candidate"
	| "validated"
	| "approved"
	| "scheduled"
	| "publishing"
	| "published"
	| "failed"
	| "cancelled";

export type DiningReleaseValidationStatus = "fail" | "pass";

export interface DiningSvgAnchor {
	anchorId: string;
	role: string;
}

export interface DiningFloorplanAsset {
	anchorInventory: DiningSvgAnchor[];
	bucket: string;
	byteSize: number;
	contentType: string;
	createdAt: string;
	createdBy: string;
	floorId: string;
	floorplanAssetId: string;
	hallId: string;
	objectKey: string;
	sanitizedSvgMarkup: string;
	sha256: string;
	sourceFilename: string;
	status: "draft_ready" | "release_ready";
}

export interface DiningDraftVersion {
	createdAt: string;
	createdBy: string;
	draftVersionId: string;
	summary: Record<string, unknown>;
	versionNumber: number;
}

export interface DiningFloorplanRef {
	anchorInventory: DiningSvgAnchor[];
	bucket: string;
	byteSize: number;
	contentType: string;
	floorId: string;
	floorplanAssetId: string;
	hallId: string;
	objectKey: string;
	sha256: string;
	windowBindings: Array<{ svgAnchorId: string | null; windowId: string }>;
}

export interface DiningReleaseCandidate {
	approvedAt: string | null;
	approvedBy: string | null;
	baseDraftVersionId: string;
	cancelledAt: string | null;
	cancelledBy: string | null;
	candidateId: string;
	createdAt: string;
	createdBy: string;
	expectedPredecessorReleaseId: string | null;
	floorplanRefs: DiningFloorplanRef[];
	notes: string;
	publishedReleaseId: string | null;
	publishMode: "manual" | "scheduled";
	scheduledAt: string | null;
	snapshotHash: string;
	status: DiningReleaseCandidateStatus;
}

export interface DiningReleaseValidationIssue {
	code:
		| "duplicate_svg_anchor_binding"
		| "floorplan_asset_checksum_mismatch"
		| "missing_floorplan_asset"
		| "missing_menu_item_projection"
		| "missing_stall_profile_projection"
		| "missing_svg_anchor"
		| "stale_release_candidate"
		| "unbound_required_window";
	message: string;
	ref: Record<string, string>;
}

export interface DiningReleaseCandidateValidationReport {
	blockers: DiningReleaseValidationIssue[];
	candidateId: string;
	createdAt: string;
	status: DiningReleaseValidationStatus;
	summary: Record<string, unknown>;
	validationReportId: string;
	warnings: DiningReleaseValidationIssue[];
}

export interface DiningReleaseScheduleJob {
	attemptCount: number;
	candidateId: string;
	createdAt: string;
	createdBy: string;
	executedAt: string | null;
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	scheduleJobId: string;
	scheduledAt: string;
	status: "scheduled" | "executed" | "failed" | "cancelled";
}

export interface DiningReleaseLatestPointer {
	releaseId: string;
	scope: "global";
	snapshotId: string;
	updatedAt: string;
	updatedBy: string;
}

export interface DiningReleaseCandidateEnvelope {
	candidate: DiningReleaseCandidate;
	snapshot: DiningPublishedSnapshot;
	validationReport: DiningReleaseCandidateValidationReport | null;
}
