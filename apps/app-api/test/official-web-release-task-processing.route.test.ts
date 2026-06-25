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

const releaseTaskRecord = {
	id: "owrelease_calendar",
	schemaVersion: "official_web_release_task_projection.v1",
	taskId: "owrelease_calendar",
	taskType: "official_web_selected_write_academic_calendar",
	sourceChannel: "official_web",
	inventoryId: "muc-public-academic-calendar",
	jobId: "owtarget_calendar",
	runId: "owrun_calendar",
	selectedWriteTarget: "calendar/academic_calendar",
	lifecycleStatus: "published",
	latestStage: "published",
	attemptCount: 1,
	maxAttempts: 3,
	inputSummary: {
		sourceObjectCount: 1,
		sourceUrls: ["https://www.muc.edu.cn/ggfw/mdxl.htm"],
	},
	outputSummary: {
		fullImpactDisplayNames: ["中央民族大学校历"],
		fullRecordCount: 2,
		recordCount: 1,
		releaseId: "release_calendar",
		taskScopeDisplayNames: ["中央民族大学校历"],
	},
	timeline: [
		{
			stage: "published",
			status: "published",
			occurredAt: "2026-05-01T08:03:00.000Z",
			summary: "official web release task observed: published",
		},
	],
	lastErrorCode: null,
	lastErrorMessage: null,
	createdAt: "2026-05-01T08:00:00.000Z",
	updatedAt: "2026-05-01T08:03:00.000Z",
	projectedAt: "2026-05-01T08:03:01.000Z",
	producerVersion: "test@1",
	redactionVersion: "official_web_release_task_redaction.v1",
	freshnessStatus: "fresh",
	observedAgeSeconds: 0,
	staleAfterSeconds: 1800,
	staleReasonCode: null,
};

const serviceGuideReleaseTaskRecord = {
	...releaseTaskRecord,
	id: "owrelease_regulation",
	taskId: "owrelease_regulation",
	taskType: "official_web_selected_write_regulation",
	inventoryId: "muc-public-regulation",
	jobId: "owtarget_regulation",
	runId: "owrun_regulation",
	selectedWriteTarget: "regulations/institutional_rules",
	inputSummary: {
		sourceObjectCount: 2,
		sourceUrls: [
			"https://xxgk.muc.edu.cn/info/1198/4101.htm",
			"https://xxgk.muc.edu.cn/info/1198/4051.htm",
		],
	},
	outputSummary: {
		fullImpactDisplayNames: ["中央民族大学学术委员会章程", "中央民族大学教职工代表大会规程"],
		fullRecordCount: 2,
		recordCount: 1,
		releaseId: "release_regulation",
		taskScopeDisplayNames: ["中央民族大学学术委员会章程"],
	},
};

describe("official web release task processing operator routes", () => {
	it("accepts sanitized release task snapshots through the internal ingest seam", async () => {
		const commandService = {
			ingestSnapshots: vi.fn().mockResolvedValue({ accepted: 1 }),
		};
		const app = createApp(
			env as never,
			{
				officialWebReleaseTaskProcessingCommandService: commandService,
			} as never,
		);

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/operator/official-web/release-task-snapshots",
				{
					body: JSON.stringify({
						snapshots: [releaseTaskRecord],
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
				snapshots: [releaseTaskRecord],
			},
		});
	});

	it("returns operator-visible release task list filters", async () => {
		const principal = createOperatorPrincipal();
		const queryService = {
			getById: vi.fn(),
			list: vi.fn().mockResolvedValue({
				page: {
					nextCursor: "cursor_02",
				},
				tasks: [releaseTaskRecord],
			}),
		};
		const app = createApp(
			env as never,
			{
				getPrincipal: vi.fn().mockResolvedValue(principal),
				officialWebReleaseTaskProcessingQueryService: queryService,
			} as never,
		);

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/official-web/release-tasks?status=published&taskType=official_web_selected_write_academic_calendar&selectedWriteTarget=calendar%2Facademic_calendar&inventoryId=muc-public-academic-calendar&jobId=owtarget_calendar&runId=owrun_calendar&limit=10",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			page: {
				nextCursor: "cursor_02",
			},
			tasks: [releaseTaskRecord],
		});
		expect(queryService.list).toHaveBeenCalledWith({
			filters: {
				cursor: null,
				inventoryId: "muc-public-academic-calendar",
				jobId: "owtarget_calendar",
				limit: 10,
				q: null,
				runId: "owrun_calendar",
				selectedWriteTarget: "calendar/academic_calendar",
				status: "published",
				taskType: "official_web_selected_write_academic_calendar",
				updatedAfter: null,
				updatedBefore: null,
			},
			principal,
		});
	});

	it("returns operator-visible release task detail by id", async () => {
		const principal = createOperatorPrincipal();
		const queryService = {
			getById: vi.fn().mockResolvedValue(releaseTaskRecord),
			list: vi.fn(),
		};
		const app = createApp(
			env as never,
			{
				getPrincipal: vi.fn().mockResolvedValue(principal),
				officialWebReleaseTaskProcessingQueryService: queryService,
			} as never,
		);

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/official-web/release-tasks/owrelease_calendar",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ task: releaseTaskRecord });
		expect(queryService.getById).toHaveBeenCalledWith({
			id: "owrelease_calendar",
			principal,
		});
	});

	it("returns regulation release task impact summary fields without dropping them", async () => {
		const principal = createOperatorPrincipal();
		const queryService = {
			getById: vi.fn().mockResolvedValue(serviceGuideReleaseTaskRecord),
			list: vi.fn(),
		};
		const app = createApp(
			env as never,
			{
				getPrincipal: vi.fn().mockResolvedValue(principal),
				officialWebReleaseTaskProcessingQueryService: queryService,
			} as never,
		);

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/official-web/release-tasks/owrelease_regulation",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			task: serviceGuideReleaseTaskRecord,
		});
	});
});
