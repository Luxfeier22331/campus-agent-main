export const INTERNAL_PORTAL_NOTICE_PUBLICATION_INTERVAL = "30 minutes";
export const INTERNAL_PORTAL_NOTICE_PUBLICATION_SCHEDULE_ID = "internal-portal-notice-publication";
export const INTERNAL_PORTAL_NOTICE_PUBLICATION_WORKFLOW_ID =
	"ingestion/internal-portal-notice-publication";
export const INTERNAL_PORTAL_NOTICE_PUBLICATION_INITIAL_PAUSE_NOTE = "awaiting operator enable";
export const INTERNAL_PORTAL_NOTICE_PUBLICATION_MANUAL_PAUSE_NOTE = "paused through Ops Web";
export const INTERNAL_PORTAL_NOTICE_PUBLICATION_MANUAL_RESUME_NOTE = "resumed through Ops Web";
export const INTERNAL_PORTAL_NOTICE_PUBLICATION_AUTH_VALIDATED_NOTE =
	"credential validated by auth maintenance";
export const INTERNAL_PORTAL_NOTICE_PUBLICATION_CREDENTIAL_EXPIRED_NOTE =
	"paused because credential expired";
export const INTERNAL_PORTAL_NOTICE_PUBLICATION_CREDENTIAL_UNAVAILABLE_NOTE =
	"paused because credential is unavailable";

export interface InternalPortalNoticePublicationStatus {
	errorCode: string | null;
	lastAttemptAt: string | null;
	lastOutcome:
		| "CREDENTIAL_EXPIRED"
		| "CREDENTIAL_UNAVAILABLE"
		| "DEFERRED"
		| "FAILED"
		| "PUBLISHED"
		| "RUNNING"
		| "UNCHANGED"
		| "UNKNOWN"
		| null;
	lastReleaseId: string | null;
	nextRunAt: string | null;
	scheduleState: "ACTIVE" | "MISSING" | "PAUSED";
	workflowId: string | null;
	workflowRunId: string | null;
}
