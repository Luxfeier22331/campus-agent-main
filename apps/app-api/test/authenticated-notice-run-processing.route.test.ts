// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ResolvedAppPrincipal } from "../src/modules/auth";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
	SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
	SUPERVISOR_API_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function createOperatorPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: ["ops"],
			principalId: "ops@example.com",
			principalType: "operator",
			roles: ["operator"],
			userId: "ops@example.com",
		},
		permissions: {
			chat: false,
			operator: true,
		},
		principal: {
			displayName: "Ops Team",
			email: "ops@example.com",
			principalId: "ops@example.com",
			type: "operator",
		},
		session: null,
	};
}

const runRecord = {
	id: "authenticated_notice_portal:run:muc_internal_portal:20260428T181953007Z",
	runKey: "authenticated_notice_portal:notice:muc_internal_portal:20260428T181953007Z",
	sourceChannel: "authenticated_notice_portal",
	sourceSurface: "notice",
	siteId: "muc_internal_portal",
	collectorRunToken: "20260428T181953007Z",
	runId: "muc_internal_portal:notice:20260428T181953007Z",
	replayBatchId: "manual-smoke-20260501",
	enqueueSource: "manual_replay",
	lifecycleStatus: "mixed_terminal",
	latestStage: "failed_terminal",
	latestQueueStatus: "failed_terminal",
	queueJobCount: 2,
	queueStatusCounts: {
		failed_terminal: 1,
		succeeded: 1,
	},
	attemptCount: 2,
	sourceTruth: {
		selectedNoticeCount: 1,
	},
	childTaskSummary: {},
	downstream: {
		candidateKinds: ["transport_schedule"],
		materializedReleaseCount: 1,
		targetSurfaces: ["campus_services"],
	},
	jobSummaries: [],
	timeline: [
		{
			eventId: "run-event-001",
			stage: "downstream_materialization",
			status: "failed_terminal",
			occurredAt: "2026-05-01T10:31:00.000Z",
			summary: "downstream materialization failed",
		},
	],
	lastErrorCode: "downstream_materialization_failed",
	lastErrorMessage: "typed materializer returned terminal failure",
	firstObservedAt: "2026-05-01T01:27:00.000Z",
	lastObservedAt: "2026-05-01T10:31:00.000Z",
	projectedAt: "2026-05-01T10:32:00.000Z",
	producerVersion: "test@1",
	redactionVersion: "authenticated_notice_processing_redaction.v1",
	freshnessStatus: "fresh",
	observedAgeSeconds: 0,
	staleAfterSeconds: 1800,
	staleReasonCode: null,
};

describe("authenticated notice run processing operator routes", () => {
	it("accepts sanitized run-level snapshots through the internal ingest seam", async () => {
		const commandService = {
			ingestSnapshots: vi.fn().mockResolvedValue({ accepted: 1 }),
		};
		const app = createApp(
			env as never,
			{
				authenticatedNoticeRunProcessingCommandService: commandService,
			} as never,
		);

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/operator/authenticated-notices/run-processing-snapshots",
				{
					body: JSON.stringify({
						snapshots: [runRecord],
					}),
					headers: {
						"content-type": "application/json",
						"x-app-internal-auth": "trusted-secret",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ accepted: 1 });
		expect(commandService.ingestSnapshots).toHaveBeenCalledWith({
			payload: {
				snapshots: [runRecord],
			},
		});
	});

	it("returns operator-visible run processing list filters", async () => {
		const principal = createOperatorPrincipal();
		const queryService = {
			getById: vi.fn(),
			list: vi.fn().mockResolvedValue({
				page: {
					nextCursor: "cursor_02",
				},
				runs: [runRecord],
			}),
		};
		const app = createApp(
			env as never,
			{
				authenticatedNoticeRunProcessingQueryService: queryService,
				getPrincipal: vi.fn().mockResolvedValue(principal),
			} as never,
		);

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/authenticated-notices/run-processing?collectorRunToken=20260428T181953007Z&status=mixed_terminal&queueStatus=failed_terminal&siteId=muc_internal_portal&sourceSurface=notice&replayBatchId=manual-smoke-20260501&limit=10",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			page: {
				nextCursor: "cursor_02",
			},
			runs: [runRecord],
		});
		expect(queryService.list).toHaveBeenCalledWith({
			filters: {
				collectorRunToken: "20260428T181953007Z",
				cursor: null,
				limit: 10,
				q: null,
				queueStatus: "failed_terminal",
				replayBatchId: "manual-smoke-20260501",
				runId: null,
				siteId: "muc_internal_portal",
				sourceSurface: "notice",
				status: "mixed_terminal",
				updatedAfter: null,
				updatedBefore: null,
			},
			principal,
		});
	});

	it("returns operator-visible run processing detail by encoded id", async () => {
		const principal = createOperatorPrincipal();
		const queryService = {
			getById: vi.fn().mockResolvedValue(runRecord),
			list: vi.fn(),
		};
		const app = createApp(
			env as never,
			{
				authenticatedNoticeRunProcessingQueryService: queryService,
				getPrincipal: vi.fn().mockResolvedValue(principal),
			} as never,
		);
		const id = encodeURIComponent(runRecord.id);

		const response = await app.fetch(
			new Request(
				`https://app-api.internal/api/operator/authenticated-notices/run-processing/${id}`,
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ run: runRecord });
		expect(queryService.getById).toHaveBeenCalledWith({
			id: runRecord.id,
			principal,
		});
	});
});
