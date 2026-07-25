export type DiningMapResponse = import("@campus-agent/dining/domain").DiningMapResponse;

export type DiningHallSummary = DiningMapResponse["halls"][number];
export type DiningFloorSummary = DiningHallSummary["floors"][number];
export type DiningWindowProjection = DiningFloorSummary["windows"][number];

export interface DiningFloorResponse {
	floor: DiningFloorSummary & { hallId: string };
	windows: DiningWindowProjection[];
}

export interface DiningSearchResult {
	campus: string;
	floorId: string;
	floorLabel: string;
	hallId: string;
	hallName: string;
	windowId: string;
	windowName: string;
}
