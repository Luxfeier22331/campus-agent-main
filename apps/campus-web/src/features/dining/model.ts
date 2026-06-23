export interface DiningHallSummary {
	campus: string;
	floors: Array<{
		floorId: string;
		label: string;
	}>;
	hallId: string;
	name: string;
}

export interface DiningHallsResponse {
	halls: DiningHallSummary[];
}

export interface DiningHallReviewsResponse {
	reviews: DiningReview[];
}

export interface DiningReview {
	campus: string;
	comment: string | null;
	contributorName: string | null;
	dishName: string;
	hallId: string;
	hallName: string;
	images: DiningReviewImage[];
	paidPriceLabel: string | null;
	rating: number | null;
	reviewId: string;
	sourceRecordId: string;
	stallName: string;
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
		canvas: {
			height: number;
			width: number;
		};
		floorId: string;
		floorplan: {
			anchorInventory: Array<{
				anchorId: string;
				label?: string;
				role: string;
			}>;
			floorId: string;
			floorplanId: string;
			hallId: string;
			sha256: string;
			svgAssetUrl: string;
		};
		hallId: string;
		label: string;
		svgAssetUrl: string;
	};
	source: {
		label: string;
		updatedAt: string;
	};
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
	geometry: {
		height: number;
		width: number;
		x: number;
		y: number;
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
	priceLabel: string;
	tags: string[];
}
