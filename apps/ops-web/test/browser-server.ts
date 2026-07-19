import { serve } from "@hono/node-server";
import { createOpsApp } from "../src/server/app.ts";
import type { IngestionControlClient } from "../src/server/ingestion-control-client.ts";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission.ts";
import { createFixtureOpsStatusStore } from "../src/server/ops-status-store.ts";
import {
	opsLogObservabilityFixture,
	opsOverviewFixture,
	opsSentryIssuesFixture,
	opsTraceObservabilityFixture,
} from "../src/shared/ops-fixtures.ts";

const browserTestPort = Number(process.env.OPS_WEB_BROWSER_TEST_PORT ?? "4178");

const app = createOpsApp({
	admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
	env: {
		OPS_WEB_PUBLIC_ORIGIN: `http://127.0.0.1:${browserTestPort}`,
	},
	axiom: {
		getTelemetrySnapshot: async () => opsOverviewFixture.telemetry,
		queryRequest: async ({ kind }) =>
			kind === "logs" ? opsLogObservabilityFixture : opsTraceObservabilityFixture,
	},
	overviewService: {
		getOverview: async () => opsOverviewFixture,
	},
	sentry: {
		queryRequestIssues: async () => opsSentryIssuesFixture,
	},
	internalPortalAuthStore: {
		getStatus: async () => ({
			configured: true,
			updatedAt: "2026-07-15T12:00:00.000Z",
			updatedBy: "ops@example.test",
		}),
		replaceCredential: async (input) => ({
			configured: true,
			updatedAt: input.updatedAt,
			updatedBy: input.updatedBy,
		}),
	},
	internalPortalMaintenanceClient: {
		getStatus: async () => internalPortalMaintenanceStatus(),
		validate: async () => internalPortalMaintenanceStatus(),
	},
	ingestionControlClient: fixtureIngestionControlClient(),
	staticRoot: "dist",
	store: createFixtureOpsStatusStore(),
});

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: browserTestPort });

function internalPortalMaintenanceStatus() {
	return {
		errorCode: null,
		lastAttemptAt: "2026-07-15T12:30:00.000Z",
		lastOutcome: "SUCCESS" as const,
		lastSuccessAt: "2026-07-15T12:30:03.000Z",
		nextRunAt: "2026-07-15T13:00:00.000Z",
		noticeProbeSucceeded: true,
		portalSessionEstablished: true,
		scheduleState: "ACTIVE" as const,
		serviceTicketIssued: true,
	};
}

function fixtureIngestionControlClient(): IngestionControlClient {
	const publication = {
		errorCode: null,
		lastAttemptAt: "2026-07-17T03:30:00.000Z",
		lastOutcome: "PUBLISHED" as const,
		lastReleaseId: "release:run-001:v1",
		nextRunAt: "2026-07-17T04:00:00.000Z",
		scheduleState: "ACTIVE" as const,
		workflowId: "ingestion/internal-portal-notice-publication",
		workflowRunId: "run-001",
	};
	const task = {
		collection: "internal_notice",
		corpus: "campus_notices",
		created_at: "2026-07-17T03:30:00.000Z",
		created_by: "schedule:internal-portal-notice",
		executor_kind: "source_collector" as const,
		has_result: true,
		last_error_code: null,
		last_error_message: null,
		pipeline_workflow_id: "ingestion/internal-portal-notice-publication",
		registry_task_id: "internal_portal.notice.capture",
		result_contract: "internal_portal_notice_capture_result.v1",
		retry_of_task_id: null,
		run_id: "run-001",
		schema_version: "ingestion_task_operator_projection.v2",
		source_channel: "internal_portal",
		source_family: "authenticated_notice",
		status: "completed" as const,
		summary: { notice_count: 12 },
		task_id: "run-001:capture",
		updated_at: "2026-07-17T03:31:00.000Z",
		workflow_id: "ingestion/run-001:capture",
		workflow_run_id: "run-capture-001",
	};
	return {
		getInternalPortalStatus: async () => ({
			auth_maintenance: internalPortalMaintenanceStatus(),
			file_release: null,
			notice: {
				publication,
				release: {
					checkpoint: { notices: [{ last_released_notice_id: 110, notice_type: "5" }] },
					current_release_id: "release:run-001:v1",
					item_count: 12,
					last_added_count: 2,
					last_check_at: "2026-07-17T03:31:00.000Z",
					last_check_error_code: null,
					last_check_mode: "incremental",
					last_check_outcome: "published",
					last_committed_at: "2026-07-17T03:31:00.000Z",
					last_published_at: "2026-07-17T03:31:00.000Z",
					last_reconcile_at: "2026-07-14T03:00:00.000Z",
					last_updated_count: 1,
					last_withdrawn_count: 0,
					stream_id: "internal_portal:muc_internal_portal:notice",
					version: 1,
				},
			},
			schema_version: "internal_portal_ingestion_status.v1",
		}),
		getStatus: async () => internalPortalMaintenanceStatus(),
		getTask: async () => task,
		listTasks: async () => ({ page: { next_cursor: null }, tasks: [task] }),
		pauseNoticePublication: async () => ({ ...publication, scheduleState: "PAUSED" }),
		validate: async () => internalPortalMaintenanceStatus(),
		resumeNoticePublication: async () => publication,
		retryTask: async (taskId) => ({
			retry_of_task_id: taskId,
			task_id: "retry:fixture-001",
			workflow_id: "ingestion/retry:fixture-001",
			workflow_run_id: "run-retry-001",
		}),
		startFileReleases: async (input) => ({
			request_id: input.requestId,
			schema_version: "internal_portal_file_release_batch_start.v1",
			workflows: input.fileReleaseIds.map((fileReleaseId) => ({
				alreadyStarted: false,
				file_release_id: fileReleaseId,
				workflowId: `ingestion/file/${fileReleaseId}`,
				workflowRunId: `run-file-${fileReleaseId}`,
				workflowStatus: "RUNNING",
			})),
		}),
		startNoticeReconcile: async (input) => ({
			already_started: false,
			request_id: input.requestId,
			temporal_status: "RUNNING",
			workflow_id: `ingestion/notice/${input.requestId}`,
			workflow_run_id: "run-reconcile-001",
		}),
	};
}
