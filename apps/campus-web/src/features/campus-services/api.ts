import { requestJson } from "@/platform/api/client";
import type { CampusTransportStatusResponse } from "./model";

export async function getCampusTransportStatus(): Promise<CampusTransportStatusResponse> {
	return requestJson<CampusTransportStatusResponse>({
		path: "/api/campus-services/transport-schedule/status",
	});
}
