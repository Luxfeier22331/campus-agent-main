export interface DiningHallSummary {
	campus: string;
	floors: Array<{
		floorId: string;
		label: string;
	}>;
	hallId: string;
	name: string;
	tags: string[];
}

export interface DiningHallsResponse {
	halls: DiningHallSummary[];
}

export interface DiningPublication {
	catalogReleaseId: string | null;
	reviewRevision: number;
	updatedAt: string;
}

export interface DiningBootstrapResponse extends DiningHallsResponse {
	initial: null | {
		floor: DiningFloorResponse;
	};
}

export interface DiningBootstrapTransportResponse extends DiningHallsResponse {
	initial: null | { floor: DiningFloorTransportResponse };
}

export interface DiningOfferingReviewsResponse {
	offeringId: string;
	reviews: DiningReview[];
}

export interface DiningReview {
	comment: string | null;
	contributorName: string | null;
	images: DiningReviewImage[];
	paidPriceLabel: string | null;
	rating: number | null;
	reviewId: string;
	submittedAt: string;
}

export interface DiningSearchResult {
	campus: string;
	floorId: string;
	floorLabel: string;
	hallId: string;
	hallName: string;
	kind: "offering" | "stall";
	offering: null | {
		offeringId: string;
		name: string;
		priceLabel: string | null;
	};
	resultId: string;
	stallName: string;
	stallProfileId: string;
	windowId: string;
	windowLabel: string;
}

export interface DiningSearchResponse {
	results: DiningSearchResult[];
	scope: { campus: string; hallId: string };
	source: { updatedAt: string };
	total: number;
}

export interface DiningReviewImage {
	alt: string;
	imageId: string;
	url: string;
}

export interface DiningFloorResponse {
	filters: {
		tags: string[];
	};
	floor: {
		floorId: string;
		floorplan:
			| {
					anchorInventory: Array<{ anchorId: string; label?: string; role: "window" }>;
					canvas: { height: number; width: number };
					floorId: string;
					floorplanId: string;
					hallId: string;
					kind: "asset";
					sha256: string;
					svgAssetUrl: string;
			  }
			| {
					anchorInventory: [];
					canvas: { height: number; width: number };
					floorplanId: string;
					kind: "placeholder";
			  }
			| {
					anchorInventory: [];
					canvas: { height: number; width: number };
					floorplanId: string;
					kind: "unavailable";
			  };
		hallId: string;
		label: string;
	};
	source: {
		updatedAt: string;
	};
	windows: DiningWindowProjection[];
}

export interface DiningFloorTransportResponse {
	filters: { tags: string[] };
	floor: {
		floorId: string;
		floorplan:
			| { floorplanId: string; kind: "asset" }
			| { floorplanId: string; kind: "placeholder" };
		hallId: string;
		label: string;
	};
	source: { updatedAt: string };
	windows: DiningWindowProjection[];
}

export interface DiningWindowProjection {
	assignment: null | {
		assignmentId: string;
		offerings: DiningOfferingProjection[];
		stallProfile: {
			displayName: string;
			stallProfileId: string;
			stallType: string;
			tags: string[];
		};
	};
	label: string;
	locationLabel: string;
	svgAnchorId: string | null;
	status: "active" | "closed" | "maintenance";
	tags: string[];
	windowId: string;
}

export interface DiningOfferingProjection {
	menuItemId: string;
	name: string;
	offeringId: string;
	priceLabel: string | null;
	tags: string[];
}
