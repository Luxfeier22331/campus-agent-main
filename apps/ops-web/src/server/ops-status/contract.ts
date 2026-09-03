import type {
	OpsOverviewResponse,
	OpsOverviewWindow,
	OpsRequestDetailResponse,
	OpsRequestListResponse,
	OpsRequestListView,
	OpsRequestSummary,
	OpsRequestWindow,
} from "../../shared/ops-contract.ts";

export interface OpsRequestListQuery {
	cursor?: string;
	q?: string;
	requestId?: string;
	status?: OpsRequestSummary["status"];
	view?: OpsRequestListView;
	window: OpsRequestWindow;
}

export type OpsStatusOverview = Pick<OpsOverviewResponse, "requests" | "trends">;

export interface OpsStatusStore {
	getOverview(window: OpsOverviewWindow): Promise<OpsStatusOverview>;
	getRequestDetail(requestId: string): Promise<OpsRequestDetailResponse | null>;
	listRequests(query: OpsRequestListQuery): Promise<OpsRequestListResponse>;
	verifyReadiness(): Promise<void>;
	verifySchema(): Promise<void>;
}

export type OpsStatusStoreUnavailableReasonCode =
	| "DB_CONNECT_FAILED"
	| "DB_PERMISSION_DENIED"
	| "MISSING_SCHEMA"
	| "OPS_STATUS_STORE_UNAVAILABLE"
	| "OPS_WEB_DATABASE_URL_MISSING";

export class OpsStatusStoreUnavailableError extends Error {
	readonly reasonCode: OpsStatusStoreUnavailableReasonCode;

	constructor(reasonCode: OpsStatusStoreUnavailableReasonCode, message: string) {
		super(message);
		this.name = "OpsStatusStoreUnavailableError";
		this.reasonCode = reasonCode;
	}
}

export interface OpsStatusEnv {
	OPS_WEB_CAMPUS_WEB_URL?: string;
}
