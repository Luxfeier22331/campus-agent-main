// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ResolvedAppPrincipal } from "../src/modules/auth";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
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

const processingRecord = {
	id: "authenticated_notice_portal:notice:muc_internal_portal:355867:run_20260427:job_01",
	noticeKey: "authenticated_notice_portal:notice:muc_internal_portal:355867",
	sourceChannel: "authenticated_notice_portal",
	sourceSurface: "notice",
	siteId: "muc_internal_portal",
	noticeId: "355867",
	title: "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
	runId: "run_20260427",
	jobId: "job_01",
	replayBatchId: "manual-smoke-20260501",
	enqueueSource: "manual_replay",
	queueStatus: "succeeded",
	lifecycleStatus: "tool_ready",
	latestStage: "tool_ready",
	targetSurface: "campus_services",
	candidateKind: "transport_schedule",
	materializationStatus: "completed",
	releaseId: "transport-schedule-run_20260427-job_01",
	current: true,
	toolReady: true,
	readModelCounts: {
		rejectedSources: 0,
		scheduledDepartures: 49,
	},
	childTaskSummary: {
		byKind: {},
		byState: {},
		total: 0,
	},
	timeline: [
		{
			stage: "tool_ready",
			status: "completed",
			occurredAt: "2026-05-01T08:00:00.000Z",
			summary: "transport_schedule_lookup read model is ready.",
		},
	],
	downstream: {
		current: true,
		releaseId: "transport-schedule-run_20260427-job_01",
		targetSurface: "campus_services",
		toolReady: true,
	},
	lastErrorCode: null,
	lastErrorMessage: null,
	attemptCount: 1,
	lastObservedAt: "2026-05-01T08:00:00.000Z",
	sourceUpdatedAt: "2026-04-27T08:00:00.000Z",
	projectedAt: "2026-05-01T08:00:01.000Z",
	producerVersion: "test@1",
	redactionVersion: "authenticated_notice_processing_redaction.v1",
};

describe("authenticated notice processing operator routes", () => {
	it("accepts sanitized processing snapshots through the internal ingest seam", async () => {
		const commandService = {
			ingestSnapshots: vi.fn().mockResolvedValue({ accepted: 1 }),
		};
		const app = createApp(
			env as never,
			{
				authenticatedNoticeProcessingCommandService: commandService,
			} as never,
		);

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/operator/authenticated-notices/processing-snapshots",
				{
					body: JSON.stringify({
						snapshots: [processingRecord],
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
				snapshots: [processingRecord],
			},
		});
	});

	it("rejects forbidden raw notice and OCR fields before storing snapshots", async () => {
		const commandService = {
			ingestSnapshots: vi.fn(),
		};
		const app = createApp(
			env as never,
			{
				authenticatedNoticeProcessingCommandService: commandService,
			} as never,
		);

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/operator/authenticated-notices/processing-snapshots",
				{
					body: JSON.stringify({
						snapshots: [
							{
								...processingRecord,
								ocrText: "raw OCR content must not reach operator projection",
							},
						],
					}),
					headers: {
						"content-type": "application/json",
						"x-app-internal-auth": "trusted-secret",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "validation_failed",
				details: {
					field: "ocrText",
				},
			},
		});
		expect(commandService.ingestSnapshots).not.toHaveBeenCalled();
	});

	it("returns operator-visible processing list filters", async () => {
		const principal = createOperatorPrincipal();
		const queryService = {
			getByNoticeId: vi.fn(),
			list: vi.fn().mockResolvedValue({
				notices: [processingRecord],
				page: {
					nextCursor: "cursor_02",
				},
			}),
		};
		const app = createApp(
			env as never,
			{
				authenticatedNoticeProcessingQueryService: queryService,
				getPrincipal: vi.fn().mockResolvedValue(principal),
			} as never,
		);

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/authenticated-notices/processing?noticeId=355867&status=tool_ready&targetSurface=campus_services&candidateKind=transport_schedule&queueStatus=succeeded&runId=run_20260427&replayBatchId=manual-smoke-20260501&limit=10",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			notices: [processingRecord],
			page: {
				nextCursor: "cursor_02",
			},
		});
		expect(queryService.list).toHaveBeenCalledWith({
			filters: {
				candidateKind: "transport_schedule",
				cursor: null,
				limit: 10,
				noticeId: "355867",
				q: null,
				queueStatus: "succeeded",
				replayBatchId: "manual-smoke-20260501",
				runId: "run_20260427",
				status: "tool_ready",
				targetSurface: "campus_services",
				updatedAfter: null,
				updatedBefore: null,
			},
			principal,
		});
	});

	it("returns operator-visible processing detail by notice id", async () => {
		const principal = createOperatorPrincipal();
		const queryService = {
			getByNoticeId: vi.fn().mockResolvedValue(processingRecord),
			list: vi.fn(),
		};
		const app = createApp(
			env as never,
			{
				authenticatedNoticeProcessingQueryService: queryService,
				getPrincipal: vi.fn().mockResolvedValue(principal),
			} as never,
		);

		const response = await app.fetch(
			new Request("https://app-api.internal/api/operator/authenticated-notices/processing/355867"),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ notice: processingRecord });
		expect(queryService.getByNoticeId).toHaveBeenCalledWith({
			noticeId: "355867",
			principal,
		});
	});
});
