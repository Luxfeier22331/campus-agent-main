export const INTERNAL_PORTAL_AUTH_SCHEDULE_ID = "internal-portal-auth-maintenance";
export const INTERNAL_PORTAL_AUTH_WORKFLOW_ID = "ingestion/internal-portal-auth-maintenance";
export const INTERNAL_PORTAL_AUTH_INTERVAL = "30 minutes";
export const INTERNAL_PORTAL_AUTH_INITIAL_PAUSE_NOTE = "awaiting initial credential";

export type InternalPortalAuthMaintenanceOutcome = "success" | "transient_failure";

export interface InternalPortalAuthMaintenanceResult {
	completedAt: string;
	errorCode: string | null;
	lastSuccessAt: string | null;
	noticeProbeSucceeded: boolean;
	outcome: InternalPortalAuthMaintenanceOutcome;
	portalSessionEstablished: boolean;
	schemaVersion: "internal_portal_auth_maintenance.v1";
	serviceTicketIssued: boolean;
	startedAt: string;
}

export interface InternalPortalAuthMaintenanceFailureDetails {
	errorCode: "internal_portal_credential_expired" | "internal_portal_credential_unavailable";
	failedAt: string;
	lastSuccessAt: string | null;
	startedAt: string;
}

export type InternalPortalAuthMaintenanceStatusOutcome =
	| "SUCCESS"
	| "TRANSIENT_FAILURE"
	| "CREDENTIAL_EXPIRED"
	| "CREDENTIAL_UNAVAILABLE"
	| "RUNNING"
	| "UNKNOWN";

export interface InternalPortalAuthMaintenanceStatus {
	errorCode: string | null;
	lastAttemptAt: string | null;
	lastOutcome: InternalPortalAuthMaintenanceStatusOutcome | null;
	lastSuccessAt: string | null;
	nextRunAt: string | null;
	noticeProbeSucceeded: boolean | null;
	portalSessionEstablished: boolean | null;
	scheduleState: "ACTIVE" | "MISSING" | "PAUSED";
	serviceTicketIssued: boolean | null;
	workflowId: string | null;
	workflowRunId: string | null;
}

export function parseInternalPortalAuthMaintenanceResult(
	value: unknown,
): InternalPortalAuthMaintenanceResult | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const candidate = value as Partial<InternalPortalAuthMaintenanceResult>;
	if (
		candidate.schemaVersion !== "internal_portal_auth_maintenance.v1" ||
		(candidate.outcome !== "success" && candidate.outcome !== "transient_failure") ||
		typeof candidate.startedAt !== "string" ||
		typeof candidate.completedAt !== "string" ||
		(candidate.lastSuccessAt !== null && typeof candidate.lastSuccessAt !== "string") ||
		(candidate.errorCode !== null && typeof candidate.errorCode !== "string") ||
		typeof candidate.serviceTicketIssued !== "boolean" ||
		typeof candidate.portalSessionEstablished !== "boolean" ||
		typeof candidate.noticeProbeSucceeded !== "boolean"
	) {
		return null;
	}
	return candidate as InternalPortalAuthMaintenanceResult;
}
