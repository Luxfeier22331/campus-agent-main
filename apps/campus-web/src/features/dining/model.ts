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

export interface DiningFloorResponse {
	floor: {
		floorId: string;
		hallId: string;
		label: string;
		svgAssetUrl: string;
	};
	source: {
		label: string;
		updatedAt: string;
	};
	stalls: Array<{
		id: string;
		locationLabel: string;
		name: string;
		priceLabel: string;
		tags: string[];
	}>;
}
