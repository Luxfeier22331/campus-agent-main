import { requestJson } from "@/platform/api/client";
import type { CampusTransportScheduleResponse } from "./model";

export async function getCampusTransportSchedule(input: {
	serviceDate: string;
}): Promise<CampusTransportScheduleResponse> {
	const params = new URLSearchParams({ serviceDate: input.serviceDate });
	return requestJson<CampusTransportScheduleResponse>({
		path: `/api/campus-services/transport-schedule?${params.toString()}`,
	});
}
