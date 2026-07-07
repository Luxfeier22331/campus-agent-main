export type CampusTransportDepartureStatus =
	| "added"
	| "cancelled"
	| "changed"
	| "delayed"
	| "normal";

export type TransportStatusGroupKind = "daily" | "temporary" | "weekday" | "weekend_holiday";
export type TransportStatusDepartureKind = "other" | "student" | "teacher";

export interface CampusServicesTransportStatusDeparture {
	departureTime: string;
	kind: TransportStatusDepartureKind;
	note?: string;
	sourceRefs: string[];
	status: CampusTransportDepartureStatus;
}

export interface CampusServicesTransportStatusRoute {
	departures: CampusServicesTransportStatusDeparture[];
	displayName: string;
	routeId: string;
}

export interface CampusServicesTransportStatusGroup {
	kind: TransportStatusGroupKind;
	routes: CampusServicesTransportStatusRoute[];
}

export interface CampusServicesTransportStatusResponse {
	groups: CampusServicesTransportStatusGroup[];
	release: {
		publishedAt: string;
		releaseId: string;
		sourceRefs: string[];
	};
}

export interface CampusServicesTransportScheduleService {
	getPublicStatus(): Promise<{
		etag: string | null;
		projection: CampusServicesTransportStatusResponse;
	}>;
}
