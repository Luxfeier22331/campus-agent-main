export type CampusTransportDepartureStatus =
	| "added"
	| "cancelled"
	| "changed"
	| "delayed"
	| "normal";

export type CampusTransportRouteStatus =
	| "limited_service"
	| "not_running"
	| "running"
	| "temporarily_suspended"
	| "unknown";

export interface CampusTransportDeparture {
	departureTime: string;
	id: string;
	note: string | null;
	sequence: number;
	sourceNoticeRefs: string[];
	status: CampusTransportDepartureStatus;
	type: "教师班次" | "学生班次" | "其他";
}

export interface CampusTransportRoute {
	departures: CampusTransportDeparture[];
	destination: string | null;
	displayName: string;
	note: string | null;
	origin: string | null;
	routeId: string;
	status: CampusTransportRouteStatus;
}

export interface CampusTransportSourceNotice {
	publishedAt: string | null;
	title: string;
	url: string;
}

export interface CampusTransportScheduleResponse {
	adjustmentCount: number;
	calendarLabel: string;
	generatedAt: string;
	hasAdjustments: boolean;
	notices: CampusTransportSourceNotice[];
	publishedAt: string | null;
	release: {
		publishedAt: string;
		releaseId: string;
	} | null;
	releaseId: string | null;
	routes: CampusTransportRoute[];
	serviceDate: string;
	serviceDayKind: "holiday" | "temporary" | "unknown" | "weekend" | "workday";
	status: "available" | "unavailable";
}
