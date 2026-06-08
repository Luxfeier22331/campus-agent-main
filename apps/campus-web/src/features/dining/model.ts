export interface DiningHallSummary {
	campus: string;
	floors: Array<{
		floorId: string;
		label: string;
	}>;
	hallId: string;
	name: string;
	offeringCount: number;
	priceRangeLabel: string | null;
	stallCount: number;
	tags: string[];
}

export interface DiningHallsResponse {
	halls: DiningHallSummary[];
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
		hallId: string;
		label: string;
		svgAssetUrl: string;
	};
	source: {
		label: string;
		releaseId: string;
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
	status: "active" | "closed" | "maintenance";
	tags: string[];
	windowId: string;
}

export interface DiningOfferingProjection {
	menuItemId: string;
	name: string;
	offeringId: string;
	priceLabel: string;
	saleStatus: "available" | "paused" | "seasonal";
	specLabel: string | null;
	tags: string[];
}
