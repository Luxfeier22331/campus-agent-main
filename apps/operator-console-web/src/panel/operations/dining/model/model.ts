export interface DiningOpsHall {
	campus: string;
	floors: Array<{
		floorId: string;
		floorplanId: string;
		floorplanSha256: string;
		label: string;
		svgAssetUrl: string;
	}>;
	hallId: string;
	name: string;
	status: "active";
}

export interface DiningWindow {
	floorId: string;
	geometry: {
		height: number;
		width: number;
		x: number;
		y: number;
	};
	hallId: string;
	label: string;
	locationLabel: string;
	svgAnchorId?: string;
	status: "active" | "closed" | "maintenance";
	tags: string[];
	windowId: string;
}

export interface DiningWindowAssignment {
	assignmentId: string;
	stallProfileId: string;
	status: "active";
	windowId: string;
}

export interface DiningStallProfile {
	displayName: string;
	stallProfileId: string;
	stallType: string;
	status: "active";
	tags: string[];
}

export interface DiningMenuItem {
	menuItemId: string;
	name: string;
	status: "active";
	tags: string[];
}

export interface DiningMenuOffering {
	assignmentId: string;
	menuItemId: string;
	offeringId: string;
	priceLabel: string;
	saleStatus: "available" | "paused" | "seasonal" | "removed";
	specLabel: string | null;
}

export interface DiningFloorplanRef {
	anchorInventory: Array<{ anchorId: string; label?: string; role: string }>;
	floorId: string;
	floorplanId: string;
	hallId: string;
	sha256: string;
	svgAssetUrl: string;
}

export interface DiningOpsFloorResponse {
	assignments: DiningWindowAssignment[];
	floor: {
		draftVersionId?: string;
		floorId: string;
		floorplan: DiningFloorplanRef;
		hallId: string;
		label: string;
		svgAssetUrl: string;
	};
	menuItems: DiningMenuItem[];
	menuOfferings: DiningMenuOffering[];
	stallProfiles: DiningStallProfile[];
	windows: DiningWindow[];
}

export interface DiningRelease {
	candidateId: string | null;
	createdAt: string;
	createdBy: string;
	notes: string;
	predecessorReleaseId: string | null;
	publishedAt: string | null;
	publishedBy: string | null;
	releaseId: string;
	snapshotHash: string;
	status: "published";
}

export interface DiningReleaseValidationIssue {
	code: string;
	message: string;
	ref: Record<string, string>;
}

export interface DiningReleaseValidationReport {
	blockers: DiningReleaseValidationIssue[];
	candidateId: string;
	createdAt: string;
	status: "fail" | "pass";
	summary: Record<string, unknown>;
	validationReportId: string;
	warnings: DiningReleaseValidationIssue[];
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
	notes: string;
	publishedReleaseId: string | null;
	publishMode: "manual" | "scheduled";
	scheduledAt: string | null;
	snapshotHash: string;
	status:
		| "candidate"
		| "validated"
		| "approved"
		| "scheduled"
		| "publishing"
		| "published"
		| "failed"
		| "cancelled";
}

export interface DiningReleaseCandidateEnvelope {
	candidate: DiningReleaseCandidate;
	validationReport: DiningReleaseValidationReport | null;
}

export interface DiningReleaseScheduleJob {
	candidateId: string;
	scheduleJobId: string;
	scheduledAt: string;
	status: "scheduled" | "executed" | "failed" | "cancelled";
}

export interface DiningAuditEvent {
	action: string;
	actorDisplayName: string;
	actorPrincipalId: string;
	auditEventId: string;
	objectId: string;
	objectKind: string;
	occurredAt: string;
}
