import { requestJson } from "@/platform/api/client";
import type { DiningFloorResponse, DiningHallsResponse } from "./model";

export async function getDiningHalls(): Promise<DiningHallsResponse> {
	return requestJson<DiningHallsResponse>({
		path: "/api/dining/halls",
	});
}

export async function getDiningFloor(input: {
	floorId: string;
	hallId: string;
}): Promise<DiningFloorResponse> {
	return requestJson<DiningFloorResponse>({
		path: `/api/dining/halls/${encodeURIComponent(input.hallId)}/floors/${encodeURIComponent(
			input.floorId,
		)}`,
	});
}
