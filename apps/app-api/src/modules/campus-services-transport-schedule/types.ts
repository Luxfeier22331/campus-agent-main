export type CampusTransportRouteStatus =
	| "limited_service"
	| "not_running"
	| "running"
	| "temporarily_suspended"
	| "unknown";

export type CampusTransportDepartureStatus =
	| "added"
	| "cancelled"
	| "changed"
	| "delayed"
	| "normal";

export interface CampusServicesTransportDeparture {
	departureTime: string;
	id: string;
	note: string | null;
	sequence: number;
	sourceNoticeRefs: string[];
	status: CampusTransportDepartureStatus;
	type: "教师班次" | "学生班次" | "其他";
}

export interface CampusServicesTransportRoute {
	departures: CampusServicesTransportDeparture[];
	destination: string | null;
	displayName: string;
	note: string | null;
	origin: string | null;
	routeId: string;
	status: CampusTransportRouteStatus;
}

export interface CampusServicesTransportSourceNotice {
	publishedAt: string | null;
	title: string;
	url: string;
}

export interface CampusServicesTransportScheduleResponse {
	adjustmentCount: number;
	calendarLabel: string;
	generatedAt: string;
	hasAdjustments: boolean;
	notices: CampusServicesTransportSourceNotice[];
	publishedAt: string | null;
	releaseId: string | null;
	routes: CampusServicesTransportRoute[];
	serviceDate: string;
	status: "available" | "unavailable";
}

export interface CampusServicesTransportScheduleService {
	getPublicSchedule(input: {
		serviceDate?: string | null;
	}): Promise<CampusServicesTransportScheduleResponse>;
}
