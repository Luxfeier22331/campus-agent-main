// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ResolvedAppPrincipal } from "../src/modules/auth";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://hub.muc.wiki",
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

const releaseTaskRecord = {
	id: "owrelease_contact",
	schemaVersion: "official_web_release_task_projection.v1",
	taskId: "owrelease_contact",
	taskType: "official_web_selected_write_contact_directory",
	sourceChannel: "official_web",
	inventoryId: "muc-main-homepage-contact",
	jobId: "owtarget_contact",
	runId: "owrun_contact",
	selectedWriteTarget: "campus_services/contact_directory",
	lifecycleStatus: "published",
	latestStage: "published",
	attemptCount: 1,
	maxAttempts: 3,
	inputSummary: {
		sourceObjectCount: 1,
		sourceUrls: ["https://www.muc.edu.cn/"],
	},
	outputSummary: {
		fullImpactDisplayNames: ["中央民族大学", "中央民族大学信息公开联系方式"],
		fullRecordCount: 2,
		recordCount: 1,
		releaseId: "release_contact",
		taskScopeDisplayNames: ["中央民族大学信息公开联系方式"],
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
	id: "owrelease_service_guide",
	taskId: "owrelease_service_guide",
	taskType: "official_web_selected_write_service_guide",
	inventoryId: "muc-information-disclosure-application-process",
	jobId: "owtarget_service_guide",
	runId: "owrun_service_guide",
	selectedWriteTarget: "campus_services/service_guide",
	inputSummary: {
		sourceObjectCount: 2,
		sourceUrls: [
			"https://xxgk.muc.edu.cn/info/1007/1113.htm",
			"https://xxgk.muc.edu.cn/info/1007/1114.htm",
		],
	},
	outputSummary: {
		fullImpactDisplayNames: ["学生校园卡服务", "中央民族大学信息公开依申请公开工作流程"],
		fullRecordCount: 2,
		recordCount: 1,
		releaseId: "release_service_guide",
		taskScopeDisplayNames: ["中央民族大学信息公开依申请公开工作流程"],
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
				"https://app-api.internal/api/operator/official-web/release-tasks?status=published&taskType=official_web_selected_write_contact_directory&selectedWriteTarget=campus_services%2Fcontact_directory&inventoryId=muc-main-homepage-contact&jobId=owtarget_contact&runId=owrun_contact&limit=10",
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
				inventoryId: "muc-main-homepage-contact",
				jobId: "owtarget_contact",
				limit: 10,
				q: null,
				runId: "owrun_contact",
				selectedWriteTarget: "campus_services/contact_directory",
				status: "published",
				taskType: "official_web_selected_write_contact_directory",
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
				"https://app-api.internal/api/operator/official-web/release-tasks/owrelease_contact",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ task: releaseTaskRecord });
		expect(queryService.getById).toHaveBeenCalledWith({
			id: "owrelease_contact",
			principal,
		});
	});

	it("returns service guide release task impact summary fields without dropping them", async () => {
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
				"https://app-api.internal/api/operator/official-web/release-tasks/owrelease_service_guide",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			task: serviceGuideReleaseTaskRecord,
		});
	});
});
