import type { DiningPublication, DiningRelease, DiningValidationReport } from "./release-types.ts";

export type DiningWindowStatus = "active" | "closed" | "maintenance";

export interface DiningOpsActor {
	displayName: string;
	principalId: string;
}

export interface DiningWindow {
	floorId: string;
	hallId: string;
	label: string;
	locationLabel: string;
	svgAnchorId: string | null;
	status: DiningWindowStatus;
	tags: string[];
	windowId: string;
}

export type DiningFloorplanSelection =
	| { floorplanId: string; kind: "asset" }
	| { floorplanId: string; kind: "placeholder" };

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
	priceLabel: string | null;
}

export interface DiningReviewImage {
	alt: string;
	imageId: string;
	url: string;
}

export interface DiningReview {
	campus: string;
	comment: string | null;
	contributorName: string | null;
	dishName: string;
	hallId: string;
	hallName: string;
	images: DiningReviewImage[];
	offeringId: string;
	paidPriceLabel: string | null;
	rating: number | null;
	reviewId: string;
	sourceRecordId: string;
	stallName: string;
	stallProfileId: string;
	submittedAt: string;
	windowId: string;
}

export interface DiningPublishedReview {
	comment: string | null;
	contributorName: string | null;
	images: DiningReviewImage[];
	paidPriceLabel: string | null;
	rating: number | null;
	reviewId: string;
	submittedAt: string;
}

export interface DiningOpsHall {
	campus: string;
	floors: Array<{
		floorId: string;
		floorplan: DiningFloorplanSelection;
		label: string;
	}>;
	hallId: string;
	name: string;
	status: "active";
}

export interface DiningCatalog {
	assignments: DiningWindowAssignment[];
	halls: DiningOpsHall[];
	menuItems: DiningMenuItem[];
	menuOfferings: DiningMenuOffering[];
	stallProfiles: DiningStallProfile[];
	windows: DiningWindow[];
}

export interface DiningDraft extends DiningCatalog {
	baseReleaseId: string | null;
	revision: number;
	updatedAt: string;
	updatedBy: string;
}

export interface DiningOpsFloorResponse {
	assignments: DiningWindowAssignment[];
	floor: {
		draftRevision?: number;
		floorId: string;
		floorplan: DiningFloorplanSelection;
		hallId: string;
		label: string;
	};
	menuItems: DiningMenuItem[];
	menuOfferings: DiningMenuOffering[];
	stallProfiles: DiningStallProfile[];
	windows: DiningWindow[];
}

export interface DiningPublishedSnapshot {
	floors: Record<string, DiningOpsFloorResponse>;
	halls: DiningOpsHall[];
	source: { label: string; releaseId: string; updatedAt: string };
}

export interface DiningPublishedHallSummary {
	campus: string;
	floors: Array<{ floorId: string; label: string }>;
	hallId: string;
	name: string;
	tags: string[];
}

export interface DiningPublishedSearchResult {
	campus: string;
	floorId: string;
	floorLabel: string;
	hallId: string;
	hallName: string;
	kind: "offering" | "stall";
	offering: null | { offeringId: string; name: string; priceLabel: string | null };
	resultId: string;
	stallName: string;
	stallProfileId: string;
	windowId: string;
	windowLabel: string;
}

export interface DiningPublishedSearchResponse {
	results: DiningPublishedSearchResult[];
	scope: { campus: string; hallId: string };
	source: { updatedAt: string };
	total: number;
}

export interface DiningPublishedFloorResponse {
	filters: { tags: string[] };
	floor: {
		floorId: string;
		floorplan: DiningFloorplanSelection;
		hallId: string;
		label: string;
	};
	source: { updatedAt: string };
	windows: Array<{
		assignment: null | {
			assignmentId: string;
			offerings: Array<{
				menuItemId: string;
				name: string;
				offeringId: string;
				priceLabel: string | null;
				tags: string[];
			}>;
			stallProfile: {
				displayName: string;
				stallProfileId: string;
				stallType: string;
				tags: string[];
			};
		};
		locationLabel: string;
		label: string;
		svgAnchorId: string | null;
		status: DiningWindowStatus;
		tags: string[];
		windowId: string;
	}>;
}

export interface DiningPublishedBootstrap {
	halls: DiningPublishedHallSummary[];
	initial: null | { floor: DiningPublishedFloorResponse };
}

export interface DiningPublicReadStore {
	getPublication(): Promise<DiningPublication>;
	getPublishedSnapshot(): Promise<DiningPublishedSnapshot | null>;
	listPublishedReviewsByOffering(input: { offeringId: string }): Promise<DiningReview[]>;
}

export interface DiningPublicReadService {
	getPublication(): Promise<DiningPublication>;
	getPublishedBootstrap(): Promise<DiningPublishedBootstrap>;
	getPublishedFloor(input: {
		floorId: string;
		hallId: string;
	}): Promise<DiningPublishedFloorResponse>;
	getPublishedHalls(): Promise<{ halls: DiningPublishedHallSummary[] }>;
	getPublishedOfferingReviews(input: { offeringId: string }): Promise<{
		offeringId: string;
		reviews: DiningPublishedReview[];
	}>;
	searchPublishedDining(input: {
		query: string;
		scopeHallId: string;
		tag: string | null;
	}): Promise<DiningPublishedSearchResponse>;
}

export interface DiningPublishResult {
	publication: DiningPublication;
	release: DiningRelease;
	snapshot: DiningPublishedSnapshot;
	validation: DiningValidationReport;
}
