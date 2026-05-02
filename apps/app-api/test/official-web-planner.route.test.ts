// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { OfficialWebPlannerService } from "../src/modules/official-web-planner";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN: "trusted-collector-token",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
	SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
	SUPERVISOR_API_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("official web planner route", () => {
	it("requires collector credentials and forwards the resolve payload", async () => {
		const service: OfficialWebPlannerService = {
			resolve: vi.fn().mockResolvedValue({
				plan: {
					duePages: [
						{
							cadenceClass: "listing_hot",
							consumerFamily: "notice_news_candidate",
							contentType: "text/html",
							discoveredFromUrl: "https://www.muc.edu.cn/news/",
							discoveryMethod: "navigation",
							etag: '"etag-1"',
							fetchProfile: "target_candidate_fetch",
							host: "www.muc.edu.cn",
							hostPolicy: {
								host: "www.muc.edu.cn",
								sourceHost: "www.muc.edu.cn",
							},
							inventoryOnly: true,
							lastChangeReason: "main_content_changed",
							lastChangedAt: "2026-03-30T08:00:00.000Z",
							lastFetchDisposition: "fetched",
							lastHttpStatus: 200,
							lastModified: "Mon, 30 Mar 2026 08:00:00 GMT",
							lastNotModifiedAt: null,
							lastSeenAt: "2026-03-30T08:00:00.000Z",
							lastSuccessfulRunId: "owrun_prev",
							mainContentHash: "main-1",
							nextEligibleFetchAt: "2026-03-30T08:30:00.000Z",
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/",
							pageFamily: "listing_page",
							pageTitleNormalized: "News",
							priorityScore: 90,
							responseBodyHash: "body-1",
							retentionPolicy: "inventory_only",
							reviewPolicy: "inventory_only",
							selectedWriteTarget: "",
							siteId: "www_muc_edu_cn",
							targetCandidateId: "owcand_news",
							targetDeclarationVersion: "muc_public_target_source_map_v2",
							targetId: "official-web-notice-news-inventory",
							targetJobId: "owtarget_news",
							worksetReason: "target_candidate_due",
						},
					],
					hostFilter: ["www.muc.edu.cn"],
					maxPagesPerHost: 10,
					maxTotalPages: 40,
					resolvedAt: "2026-03-30T09:00:00.000Z",
					runIntent: "hot",
					siteId: "www_muc_edu_cn",
					summary: {
						duePages: 1,
						listingPages: 1,
						repairPages: 0,
						selectedHosts: 1,
						staticPages: 0,
						targetJobs: 1,
						worksetRows: 1,
					},
				},
			}),
		};
		const app = createApp(env, {
			officialWebPlannerService: service,
		});

		const unauthorized = await app.fetch(
			new Request("https://app-api.internal/api/official-web/plans:resolve", {
				body: JSON.stringify({
					hostFilter: ["www.muc.edu.cn"],
					maxPagesPerHost: 10,
					maxTotalPages: 40,
					runIntent: "hot",
					siteId: "www_muc_edu_cn",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);
		expect(unauthorized.status).toBe(401);

		const authorized = await app.fetch(
			new Request("https://app-api.internal/api/official-web/plans:resolve", {
				body: JSON.stringify({
					hostFilter: ["www.muc.edu.cn"],
					maxPagesPerHost: 10,
					maxTotalPages: 40,
					now: "2026-03-30T09:00:00.000Z",
					runIntent: "hot",
					siteId: "www_muc_edu_cn",
					targetCandidateIds: ["owcand_news"],
				}),
				headers: {
					authorization: "Bearer trusted-collector-token",
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(authorized.status).toBe(200);
		await expect(authorized.json()).resolves.toEqual({
			plan: expect.objectContaining({
				duePages: [
					expect.objectContaining({
						cadenceClass: "listing_hot",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/news/",
					}),
				],
				runIntent: "hot",
				siteId: "www_muc_edu_cn",
			}),
		});
		expect(service.resolve).toHaveBeenCalledWith({
			payload: {
				hostFilter: ["www.muc.edu.cn"],
				maxPagesPerHost: 10,
				maxTotalPages: 40,
				now: "2026-03-30T09:00:00.000Z",
				runIntent: "hot",
				siteId: "www_muc_edu_cn",
				targetCandidateIds: ["owcand_news"],
			},
			principal: {
				kind: "service",
				serviceClass: "official_web_collector",
				serviceId: "official-web-collector",
			},
		});
	});
});
