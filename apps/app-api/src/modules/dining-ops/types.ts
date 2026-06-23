import type {
	DiningDraftVersion,
	DiningFloorplanManifestRef,
	DiningReleaseCandidate,
	DiningReleaseCandidateEnvelope,
	DiningReleaseCandidateValidationReport,
	DiningReleaseLatestPointer,
	DiningReleaseScheduleJob,
} from "./release-types";

export type DiningWindowStatus = "active" | "closed" | "maintenance";
export type DiningReleaseStatus = "published";

export interface DiningOpsActor {
	displayName: string;
	principalId: string;
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
	svgAnchorId: string | null;
	status: DiningWindowStatus;
	tags: string[];
	windowId: string;
}

export interface DiningStallProfile {
	displayName: string;
	stallProfileId: string;
	stallType: string;
	status: "active";
	tags: string[];
}

export interface DiningWindowAssignment {
	assignmentId: string;
	stallProfileId: string;
	status: "active";
	windowId: string;
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
}

export interface DiningAuditEvent {
	action: string;
	actorDisplayName: string;
	actorPrincipalId: string;
	after: Record<string, unknown> | null;
	auditEventId: string;
	before: Record<string, unknown> | null;
	objectId: string;
	objectKind: string;
	occurredAt: string;
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
	status: DiningReleaseStatus;
}

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

export interface DiningOpsFloorResponse {
	assignments: DiningWindowAssignment[];
	floor: {
		canvas?: { height: number; width: number };
		draftVersionId?: string;
		floorId: string;
		floorplan: Omit<DiningFloorplanManifestRef, "sanitizedSvgMarkup">;
		hallId: string;
		label: string;
		svgAssetUrl: string;
	};
	menuItems: DiningMenuItem[];
	menuOfferings: DiningMenuOffering[];
	stallProfiles: DiningStallProfile[];
	windows: DiningWindow[];
}

export interface DiningPublishedSnapshot {
	halls: DiningOpsHall[];
	floors: Record<string, DiningOpsFloorResponse>;
	source: {
		label: string;
		releaseId: string;
		updatedAt: string;
	};
}

export interface DiningOperationsState {
	auditEvents: DiningAuditEvent[];
	assignments: DiningWindowAssignment[];
	candidateSnapshots: Record<string, DiningPublishedSnapshot>;
	currentDraftVersion: DiningDraftVersion;
	draftVersions: DiningDraftVersion[];
	halls: DiningOpsHall[];
	menuItems: DiningMenuItem[];
	menuOfferings: DiningMenuOffering[];
	publishedRelease: DiningRelease | null;
	publishedSnapshot: DiningPublishedSnapshot | null;
	releaseCandidateValidationReports: DiningReleaseCandidateValidationReport[];
	releaseCandidates: DiningReleaseCandidate[];
	releaseLatestPointer: DiningReleaseLatestPointer | null;
	releaseScheduleJobs: DiningReleaseScheduleJob[];
	releaseSnapshots: Record<string, DiningPublishedSnapshot>;
	releases: DiningRelease[];
	stallProfiles: DiningStallProfile[];
	windows: DiningWindow[];
}

export interface DiningOperationsStore {
	getState(): Promise<DiningOperationsState>;
	saveState(state: DiningOperationsState): Promise<void>;
}

export interface DiningOperationsService {
	assignWindow(input: {
		actor: DiningOpsActor;
		input: {
			stallProfile: {
				displayName: string;
				stallType: string;
				tags: string[];
			};
			windowId: string;
		};
	}): Promise<{ assignment: DiningWindowAssignment; stallProfile: DiningStallProfile }>;
	createMenuItem(input: {
		actor: DiningOpsActor;
		input: { name: string; tags: string[] };
	}): Promise<{ menuItem: DiningMenuItem }>;
	createMenuOffering(input: {
		actor: DiningOpsActor;
		input: {
			assignmentId: string;
			menuItemId: string;
			priceLabel: string;
		};
	}): Promise<{ offering: DiningMenuOffering }>;
	getFloor(input: { floorId: string; hallId: string }): Promise<DiningOpsFloorResponse>;
	getPublishedFloor(input: { floorId: string; hallId: string }): Promise<{
		filters: {
			tags: string[];
		};
		floor: {
			canvas: { height: number; width: number };
			floorId: string;
			floorplan: Omit<DiningFloorplanManifestRef, "sanitizedSvgMarkup">;
			hallId: string;
			label: string;
			svgAssetUrl: string;
		};
		source: { label: string; updatedAt: string };
		windows: Array<{
			assignment: null | {
				assignmentId: string;
				offerings: Array<{
					menuItemId: string;
					name: string;
					offeringId: string;
					priceLabel: string;
					tags: string[];
				}>;
				stallProfile: {
					displayName: string;
					stallProfileId: string;
					stallType: string;
					tags: string[];
				};
			};
			geometry: DiningWindow["geometry"];
			locationLabel: string;
			label: string;
			svgAnchorId: string | null;
			status: DiningWindowStatus;
			tags: string[];
			windowId: string;
		}>;
	}>;
	getPublishedHalls(): Promise<{
		halls: Array<{
			campus: string;
			floors: Array<{ floorId: string; label: string }>;
			hallId: string;
			name: string;
		}>;
	}>;
	listAuditEvents(): Promise<{ events: DiningAuditEvent[] }>;
	listHalls(): Promise<{ halls: DiningOpsHall[] }>;
	listReleaseCandidates(): Promise<{ candidates: DiningReleaseCandidate[] }>;
	listReleases(): Promise<{ releases: DiningRelease[] }>;
	createReleaseCandidate(input: {
		actor: DiningOpsActor;
		input: { notes: string };
	}): Promise<DiningReleaseCandidateEnvelope>;
	getReleaseCandidate(input: { candidateId: string }): Promise<DiningReleaseCandidateEnvelope>;
	validateReleaseCandidate(input: {
		actor: DiningOpsActor;
		candidateId: string;
	}): Promise<DiningReleaseCandidateEnvelope>;
	approveReleaseCandidate(input: {
		actor: DiningOpsActor;
		candidateId: string;
		input: { notes: string };
	}): Promise<DiningReleaseCandidateEnvelope>;
	scheduleReleaseCandidate(input: {
		actor: DiningOpsActor;
		candidateId: string;
		input: { scheduledAt: string };
	}): Promise<DiningReleaseCandidateEnvelope & { scheduleJob: DiningReleaseScheduleJob }>;
	publishReleaseCandidate(input: {
		actor: DiningOpsActor;
		candidateId: string;
	}): Promise<{ release: DiningRelease; snapshot: DiningPublishedSnapshot }>;
	cancelReleaseCandidate(input: {
		actor: DiningOpsActor;
		candidateId: string;
	}): Promise<DiningReleaseCandidateEnvelope>;
	getRelease(input: { releaseId: string }): Promise<{
		release: DiningRelease;
		snapshot: DiningPublishedSnapshot;
	}>;
	rollbackRelease(input: {
		actor: DiningOpsActor;
		input: { mode: "latest_pointer"; notes: string };
		releaseId: string;
	}): Promise<{ release: DiningRelease; snapshot: DiningPublishedSnapshot }>;
	updateMenuItem(input: {
		actor: DiningOpsActor;
		input: { name?: string; status?: "active"; tags?: string[] };
		menuItemId: string;
	}): Promise<{ menuItem: DiningMenuItem }>;
	updateMenuOffering(input: {
		actor: DiningOpsActor;
		input: { priceLabel?: string };
		offeringId: string;
	}): Promise<{ offering: DiningMenuOffering }>;
	updateWindow(input: {
		actor: DiningOpsActor;
		input: Partial<
			Pick<DiningWindow, "geometry" | "label" | "locationLabel" | "status" | "svgAnchorId" | "tags">
		>;
		windowId: string;
	}): Promise<{ window: DiningWindow }>;
	updateWindowAssignment(input: {
		actor: DiningOpsActor;
		assignmentId: string;
		input: {
			stallProfile?: {
				displayName: string;
				stallType: string;
				tags: string[];
			};
			status?: "active";
		};
	}): Promise<{ assignment: DiningWindowAssignment; stallProfile: DiningStallProfile }>;
}
