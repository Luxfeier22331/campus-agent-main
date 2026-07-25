import { serve } from "@hono/node-server";
import { createOpsApp } from "../src/server/app.ts";
import type { IngestionControlClient } from "../src/server/ingestion-control-client.ts";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission.ts";
import { createFixtureOpsStatusStore } from "../src/server/ops-status-store.ts";
import type { ExecutionModelSettingsStatus } from "../src/shared/ops-contract.ts";
import {
	opsLogObservabilityFixture,
	opsOverviewFixture,
	opsSentryIssuesFixture,
	opsTraceObservabilityFixture,
} from "../src/shared/ops-fixtures.ts";

const browserTestPort = Number(process.env.OPS_WEB_BROWSER_TEST_PORT ?? "4178");
const browserLogObservabilityFixture = {
	...opsLogObservabilityFixture,
	records: Array.from({ length: 30 }, (_, index) => ({
		...opsLogObservabilityFixture.records[0],
		eventType: index === 0 ? "request.finalized" : `request.event.${index}`,
	})),
};

const app = createOpsApp({
	admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
	env: {
		OPS_WEB_PUBLIC_ORIGIN:
			process.env.OPS_WEB_PUBLIC_ORIGIN ?? `http://127.0.0.1:${browserTestPort}`,
	},
	axiom: {
		getTelemetrySnapshot: async () => opsOverviewFixture.telemetry,
		queryRequest: async ({ completedAt, kind, requestId, startedAt, traceId }) => {
			if (requestId === "req_ops_001") {
				return kind === "logs" ? browserLogObservabilityFixture : opsTraceObservabilityFixture;
			}
			const fixture = kind === "logs" ? opsLogObservabilityFixture : opsTraceObservabilityFixture;
			return {
				...fixture,
				dataState: "NO_DATA" as const,
				from: startedAt,
				records: [],
				requestId,
				to: completedAt ?? startedAt,
				traceId,
			};
		},
	},
	overviewService: {
		getOverview: async () => opsOverviewFixture,
	},
	sentry: {
		queryRequestIssues: async ({ completedAt, requestId, startedAt, traceId }) =>
			requestId === "req_ops_001"
				? opsSentryIssuesFixture
				: {
						...opsSentryIssuesFixture,
						dataState: "NO_DATA" as const,
						from: startedAt,
						issues: [],
						requestId,
						searchQuery: `campus.request_id:${JSON.stringify(requestId)}`,
						to: completedAt ?? startedAt,
						traceId,
					},
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
	hindsightModelSettingsStore: fixtureHindsightModelSettingsStore(),
	providerConfigClient: fixtureProviderConfigClient(),
	staticRoot: "dist",
	store: createFixtureOpsStatusStore(),
});

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: browserTestPort });

function fixtureProviderConfigClient() {
	let counter = 1;
	const status: ExecutionModelSettingsStatus = {
		etag: "etag-1",
		sampledAt: new Date().toISOString(),
		settings: {
			embedding: {
				baseUrl: "https://embedding.example.test/v1",
				credentialConfigured: true,
				credentialLast4: "demo",
				dimensions: 2560,
				kind: "embedding",
				latestValidation: {
					message: "Embedding validation passed.",
					observedDimensions: 2560,
					status: "passed",
					validatedAt: "2026-07-16T00:05:00.000Z",
					validatedBy: "ops@example.test",
				},
				model: "Qwen3-Embedding-4B",
				provider: "openai-compatible",
				transport: "embeddings",
				updatedAt: "2026-07-16T00:00:00.000Z",
				updatedBy: "ops@example.test",
			},
			llm: {
				baseUrl: "https://provider.example.test/v1",
				credentialConfigured: true,
				credentialLast4: "demo",
				kind: "llm",
				latestValidation: {
					message: "LLM validation passed.",
					status: "passed",
					validatedAt: "2026-07-16T00:05:00.000Z",
					validatedBy: "ops@example.test",
				},
				model: "primary-demo-model",
				provider: "openai",
				transport: "responses",
				updatedAt: "2026-07-16T00:00:00.000Z",
				updatedBy: "ops@example.test",
			},
		},
	};
	return {
		async getStatus() {
			return status;
		},
		async put(kind: "llm" | "embedding", body: Record<string, unknown>) {
			counter += 1;
			const current = status.settings[kind];
			status.etag = `etag-${counter}`;
			status.settings[kind] = {
				baseUrl: String(body.baseUrl),
				credentialConfigured: true,
				credentialLast4: String(body.apiKey || current?.credentialLast4 || "").slice(-4),
				...(kind === "embedding" ? { dimensions: 2560 } : {}),
				kind,
				latestValidation: {
					message: "Validation passed.",
					...(kind === "embedding" ? { observedDimensions: 2560 } : {}),
					status: "passed",
					validatedAt: new Date().toISOString(),
					validatedBy: "ops@example.test",
				},
				model: kind === "embedding" ? "Qwen3-Embedding-4B" : String(body.model),
				provider:
					kind === "embedding"
						? "openai-compatible"
						: (body.provider as "openai" | "openai-compatible"),
				transport:
					kind === "embedding"
						? "embeddings"
						: (body.transport as "responses" | "chat_completions"),
				updatedAt: new Date().toISOString(),
				updatedBy: "ops@example.test",
			};
			return status;
		},
		async validate(kind: "llm" | "embedding") {
			return {
				kind,
				validation: {
					message: "Validation passed.",
					status: "passed" as const,
					validatedAt: new Date().toISOString(),
					validatedBy: "ops@example.test",
				},
			};
		},
	};
}
function fixtureHindsightModelSettingsStore() {
	let counter = 1;
	const status = {
		applyState: "applied" as "pending" | "applying" | "applied",
		configState: "configured" as const,
		etag: "hindsight-etag-1",
		embedding: {
			baseUrl: "https://embedding.example.test/v1",
			credentialConfigured: true,
			credentialLast4: "demo",
			dimensions: 2560 as const,
			model: "Qwen3-Embedding-4B" as const,
		},
		llm: {
			baseUrl: "https://provider.example.test/v1",
			credentialConfigured: true,
			credentialLast4: "demo",
			model: "hindsight-demo-model",
			provider: "openai" as const,
		},
		failure: null,
		rerank: { provider: "rrf" as const },
		runtimeState: "running" as const,
		sampledAt: new Date().toISOString(),
		updatedAt: "2026-07-16T00:00:00.000Z",
		updatedBy: "ops@example.test",
	};
	return {
		async getStatus() {
			return status;
		},
		async replaceSettings(input: {
			settings: {
				embedding: { apiKey?: string; baseUrl: string };
				llm: { apiKey?: string; baseUrl: string; model: string };
			};
			updatedAt: string;
			updatedBy: string;
		}) {
			counter += 1;
			status.etag = `hindsight-etag-${counter}`;
			status.embedding.baseUrl = input.settings.embedding.baseUrl;
			if (input.settings.embedding.apiKey) {
				status.embedding.credentialLast4 = input.settings.embedding.apiKey.slice(-4);
			}
			status.llm.baseUrl = input.settings.llm.baseUrl;
			status.llm.model = input.settings.llm.model;
			if (input.settings.llm.apiKey) {
				status.llm.credentialLast4 = input.settings.llm.apiKey.slice(-4);
			}
			status.sampledAt = input.updatedAt;
			status.applyState = "pending";
			status.updatedAt = input.updatedAt;
			status.updatedBy = input.updatedBy;
			return status;
		},
		async apply() {
			status.applyState = "applying";
			return status;
		},
	};
}

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
