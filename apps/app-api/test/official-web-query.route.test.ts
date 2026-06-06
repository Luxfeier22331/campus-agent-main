// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { OfficialWebQueryService } from "../src/modules/official-web-query";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://hub.muc.wiki",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
	EXECUTION_GATEWAY_BASE_URL: "https://execution-gateway.internal",
	EXECUTION_GATEWAY_SHARED_SECRET: "shared-secret",
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

function createCampusPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType: "campus_member",
			roles: ["campus_member"],
			userId: "user_01HQ",
		},
		permissions: {
			chat: true,
			operator: false,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu",
			principalId: "user_01HQ",
			type: "campus_member",
		},
		session: {
			expiresAt: "2026-03-29T07:00:00.000Z",
			sessionId: "sess_01HQ",
		},
	};
}

describe("official web operator query routes", () => {
	it("returns site summaries for operator principals only", async () => {
		const principal = createOperatorPrincipal();
		const service: OfficialWebQueryService = {
			getRunById: vi.fn(),
			getSiteById: vi.fn(),
			listRuns: vi.fn(),
			listSites: vi.fn().mockResolvedValue({
				sites: [
					{
						displayName: "Www Muc Edu Cn",
						hostRoots: ["www.muc.edu.cn"],
						id: "www_muc_edu_cn",
						lastFailureAt: null,
						lastSuccessAt: "2026-03-29T08:17:32.000Z",
						latestCollectorVersion: "official-web-collector@0.1.0",
						latestConfigVersion: "git:abc1234",
						latestIngestionDispatchStatus: "queued",
						latestRunId: "owrun_01HQ",
						latestRunStatus: "completed",
						projectedAt: "2026-03-29T08:17:33.000Z",
						siteId: "www_muc_edu_cn",
					},
				],
			}),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal),
			officialWebQueryService: service,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/operator/official-web/sites"),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			sites: [
				{
					displayName: "Www Muc Edu Cn",
					hostRoots: ["www.muc.edu.cn"],
					id: "www_muc_edu_cn",
					lastFailureAt: null,
					lastSuccessAt: "2026-03-29T08:17:32.000Z",
					latestCollectorVersion: "official-web-collector@0.1.0",
					latestConfigVersion: "git:abc1234",
					latestIngestionDispatchStatus: "queued",
					latestRunId: "owrun_01HQ",
					latestRunStatus: "completed",
					projectedAt: "2026-03-29T08:17:33.000Z",
					siteId: "www_muc_edu_cn",
				},
			],
		});
		expect(service.listSites).toHaveBeenCalledWith({
			principal,
		});
	});

	it("returns site detail with recent runs", async () => {
		const principal = createOperatorPrincipal();
		const service: OfficialWebQueryService = {
			getRunById: vi.fn(),
			getSiteById: vi.fn().mockResolvedValue({
				freshnessBacklog: {
					deletedPages: [
						{
							cadenceClass: "baseline_static",
							host: "www.muc.edu.cn",
							lastChangeReason: "http_deleted",
							lastChangedAt: "2026-03-29T08:17:32.000Z",
							lastFetchDisposition: "deleted",
							lastHttpStatus: 404,
							lastSeenAt: "2026-03-29T08:17:32.000Z",
							nextEligibleFetchAt: "2026-03-30T08:17:32.000Z",
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/deleted",
							pageFamily: "article_detail",
							pageTitleNormalized: "Deleted Notice",
							priorityScore: 40,
							siteId: "www_muc_edu_cn",
						},
					],
					duePages: [
						{
							cadenceClass: "listing_hot",
							host: "www.muc.edu.cn",
							lastChangeReason: "main_content_changed",
							lastChangedAt: "2026-03-29T08:17:32.000Z",
							lastFetchDisposition: "fetched",
							lastHttpStatus: 200,
							lastSeenAt: "2026-03-29T08:17:32.000Z",
							nextEligibleFetchAt: "2026-03-29T08:30:00.000Z",
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/",
							pageFamily: "listing_page",
							pageTitleNormalized: "News",
							priorityScore: 90,
							siteId: "www_muc_edu_cn",
						},
					],
					failedFetchPages: [
						{
							cadenceClass: "repair",
							host: "www.muc.edu.cn",
							lastChangeReason: "fetch_failed",
							lastChangedAt: "2026-03-29T08:17:32.000Z",
							lastFetchDisposition: "fetch_failed",
							lastHttpStatus: 502,
							lastSeenAt: "2026-03-29T08:17:32.000Z",
							nextEligibleFetchAt: "2026-03-29T09:00:00.000Z",
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/failure",
							pageFamily: "article_detail",
							pageTitleNormalized: "Failed Notice",
							priorityScore: 85,
							siteId: "www_muc_edu_cn",
						},
					],
					hotPages: [
						{
							cadenceClass: "detail_recent",
							host: "www.muc.edu.cn",
							lastChangeReason: "new_page",
							lastChangedAt: "2026-03-29T08:17:32.000Z",
							lastFetchDisposition: "fetched",
							lastHttpStatus: 200,
							lastSeenAt: "2026-03-29T08:17:32.000Z",
							nextEligibleFetchAt: "2026-03-29T08:35:00.000Z",
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/2",
							pageFamily: "article_detail",
							pageTitleNormalized: "Hot Detail",
							priorityScore: 88,
							siteId: "www_muc_edu_cn",
						},
					],
				},
				freshnessSummary: {
					changedLast24h: 3,
					deletedPages: 1,
					duePages: 7,
					failedFetchPages: 2,
					hotPages: 9,
					repairPages: 2,
					totalPages: 120,
				},
				recentPageChanges: [
					{
						changeStatus: "changed",
						fetchDisposition: "fetched",
						host: "www.muc.edu.cn",
						httpStatus: 200,
						id: "owobs_01",
						lastChangeReason: "main_content_changed",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/news/1",
						observedAt: "2026-03-29T08:17:32.000Z",
						pageFamily: "article_detail",
						pageTitleNormalized: "News 1",
						rawAssetId: "raw_01",
						rawVersionId: "rawv_01",
						runId: "owrun_01HQ",
					},
				],
				recentRuns: [
					{
						artifacts: [],
						collectorVersion: "official-web-collector@0.1.0",
						configVersion: "git:abc1234",
						failureCount: 0,
						finishedAt: "2026-03-29T08:17:32.000Z",
						id: "owrun_01HQ",
						ingestionDispatchRef: null,
						ingestionDispatchStatus: "queued",
						lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
						projectedAt: "2026-03-29T08:17:33.000Z",
						runId: "owrun_01HQ",
						runIntent: "baseline",
						siteId: "www_muc_edu_cn",
						startedAt: "2026-03-29T08:00:01.000Z",
						status: "completed",
						summary: {
							failureCount: 0,
						},
					},
				],
				site: {
					displayName: "Www Muc Edu Cn",
					hostRoots: ["www.muc.edu.cn"],
					id: "www_muc_edu_cn",
					lastFailureAt: null,
					lastSuccessAt: "2026-03-29T08:17:32.000Z",
					latestCollectorVersion: "official-web-collector@0.1.0",
					latestConfigVersion: "git:abc1234",
					latestIngestionDispatchStatus: "queued",
					latestRunId: "owrun_01HQ",
					latestRunStatus: "completed",
					projectedAt: "2026-03-29T08:17:33.000Z",
					siteId: "www_muc_edu_cn",
				},
			}),
			listRuns: vi.fn(),
			listSites: vi.fn(),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal),
			officialWebQueryService: service,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/operator/official-web/sites/www_muc_edu_cn"),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			freshnessBacklog: {
				deletedPages: [
					expect.objectContaining({
						lastFetchDisposition: "deleted",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/news/deleted",
					}),
				],
				duePages: [
					expect.objectContaining({
						cadenceClass: "listing_hot",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/news/",
					}),
				],
				failedFetchPages: [
					expect.objectContaining({
						lastFetchDisposition: "fetch_failed",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/news/failure",
					}),
				],
				hotPages: [
					expect.objectContaining({
						cadenceClass: "detail_recent",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/news/2",
					}),
				],
			},
			freshnessSummary: expect.objectContaining({
				duePages: 7,
				totalPages: 120,
			}),
			recentPageChanges: [
				expect.objectContaining({
					changeStatus: "changed",
					normalizedCanonicalUrl: "https://www.muc.edu.cn/news/1",
				}),
			],
			recentRuns: [
				expect.objectContaining({
					id: "owrun_01HQ",
					runId: "owrun_01HQ",
				}),
			],
			site: expect.objectContaining({
				id: "www_muc_edu_cn",
				siteId: "www_muc_edu_cn",
			}),
		});
	});

	it("returns crawl run list filters and fails closed for missing or non-operator principals", async () => {
		const principal = createOperatorPrincipal();
		const service: OfficialWebQueryService = {
			getRunById: vi.fn(),
			getSiteById: vi.fn(),
			listRuns: vi.fn().mockResolvedValue({
				page: {
					nextCursor: "cursor_02",
				},
				runs: [
					{
						artifacts: [],
						collectorVersion: "official-web-collector@0.1.0",
						configVersion: "git:abc1234",
						failureCount: 0,
						finishedAt: "2026-03-29T08:17:32.000Z",
						id: "owrun_01HQ",
						ingestionDispatchRef: null,
						ingestionDispatchStatus: "queued",
						lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
						projectedAt: "2026-03-29T08:17:33.000Z",
						runId: "owrun_01HQ",
						runIntent: "baseline",
						siteId: "www_muc_edu_cn",
						startedAt: "2026-03-29T08:00:01.000Z",
						status: "completed",
						summary: {
							failureCount: 0,
						},
					},
				],
			}),
			listSites: vi.fn(),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal),
			officialWebQueryService: service,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/official-web/runs?siteId=www_muc_edu_cn&status=completed&ingestionDispatchStatus=queued&runIntent=hot&limit=10",
			),
		);

		expect(response.status).toBe(200);
		expect(service.listRuns).toHaveBeenCalledWith({
			filters: {
				cursor: null,
				ingestionDispatchStatus: "queued",
				limit: 10,
				runIntent: "hot",
				siteId: "www_muc_edu_cn",
				startedAfter: null,
				startedBefore: null,
				status: "completed",
			},
			principal,
		});

		const anonymous = await createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(null),
			officialWebQueryService: service,
		}).fetch(new Request("https://app-api.internal/api/operator/official-web/runs"));
		expect(anonymous.status).toBe(401);

		const forbidden = await createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			officialWebQueryService: service,
		}).fetch(new Request("https://app-api.internal/api/operator/official-web/runs"));
		expect(forbidden.status).toBe(403);
	});

	it("returns one crawl run detail projection", async () => {
		const principal = createOperatorPrincipal();
		const service: OfficialWebQueryService = {
			getRunById: vi.fn().mockResolvedValue({
				pageChangeSummary: {
					changedPages: 1,
					deletedPages: 0,
					failedFetchPages: 1,
					newPages: 2,
					notModifiedPages: 8,
				},
				pageChanges: [
					{
						changeStatus: "changed",
						fetchDisposition: "fetched",
						host: "www.muc.edu.cn",
						httpStatus: 200,
						id: "owobs_01",
						lastChangeReason: "main_content_changed",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/news/1",
						observedAt: "2026-03-29T08:17:32.000Z",
						pageFamily: "article_detail",
						pageTitleNormalized: "News 1",
						rawAssetId: "raw_01",
						rawVersionId: "rawv_01",
						runId: "owrun_01HQ",
					},
				],
				run: {
					artifacts: [
						{
							artifactType: "crawl_run_manifest",
							contentSha256: "abc123",
							objectKey: "official_web/www_muc_edu_cn/runs/owrun_01HQ/crawl-run.json",
							recordCount: 1,
						},
					],
					collectorVersion: "official-web-collector@0.1.0",
					configVersion: "git:abc1234",
					failureCount: 0,
					finishedAt: "2026-03-29T08:17:32.000Z",
					id: "owrun_01HQ",
					ingestionDispatchRef: null,
					ingestionDispatchStatus: "queued",
					lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
					projectedAt: "2026-03-29T08:17:33.000Z",
					runId: "owrun_01HQ",
					runIntent: "baseline",
					siteId: "www_muc_edu_cn",
					startedAt: "2026-03-29T08:00:01.000Z",
					status: "completed",
					summary: {
						failureCount: 0,
					},
				},
			}),
			getSiteById: vi.fn(),
			listRuns: vi.fn(),
			listSites: vi.fn(),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal),
			officialWebQueryService: service,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/operator/official-web/runs/owrun_01HQ"),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			run: {
				pageChangeSummary: expect.objectContaining({
					changedPages: 1,
					failedFetchPages: 1,
				}),
				pageChanges: [
					expect.objectContaining({
						changeStatus: "changed",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/news/1",
					}),
				],
				run: expect.objectContaining({
					id: "owrun_01HQ",
					runId: "owrun_01HQ",
					siteId: "www_muc_edu_cn",
				}),
			},
		});
	});
});
