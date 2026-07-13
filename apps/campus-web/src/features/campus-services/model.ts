export type CampusTransportDepartureStatus =
	| "added"
	| "cancelled"
	| "changed"
	| "delayed"
	| "normal";

export type CampusTransportGroupKind = "daily" | "temporary" | "weekday" | "weekend_holiday";

export type CampusTransportDepartureKind = "other" | "student" | "teacher";

export interface CampusTransportDeparture {
	departureTime: string;
	kind: CampusTransportDepartureKind;
	note?: string;
	serviceDate?: string;
	sourceRefs: string[];
	status: CampusTransportDepartureStatus;
}

export interface CampusTransportRoute {
	departures: CampusTransportDeparture[];
	displayName: string;
	routeId: string;
}

export interface CampusTransportStatusGroup {
	kind: CampusTransportGroupKind;
	routes: CampusTransportRoute[];
}

export interface CampusTransportStatusResponse {
	groups: CampusTransportStatusGroup[];
	release: {
		publishedAt: string;
		releaseId: string;
		sourceRefs: string[];
	};
}
