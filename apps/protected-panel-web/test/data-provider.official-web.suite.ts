import { expect, it, vi } from "vitest";

import { protectedPanelDataProvider } from "../src/panel/data-provider";
import { createJsonResponse } from "./data-provider.test-support";

export function registerDataProviderOfficialWebSuite() {
	it("maps official web run filters onto the protected same-site runtime seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				page: {
					nextCursor: "cursor_ow_02",
				},
				runs: [
					{
						artifacts: [],
						collectorVersion: "official-web-collector@0.1.0",
						configVersion: "git:abc1234",
						failureCount: 0,
						finishedAt: "2026-03-29T08:17:32.000Z",
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
		);

		const response = await protectedPanelDataProvider.getList("officialWebRuns", {
			filter: {
				ingestionDispatchStatus: "queued",
				runIntent: "hot",
				siteId: "www_muc_edu_cn",
				status: "completed",
			},
			meta: undefined,
			pagination: {
				page: 1,
				perPage: 20,
			},
			signal: undefined,
			sort: {
				field: "startedAt",
				order: "DESC",
			},
		});

		expect(response.data[0]).toMatchObject({
			id: "owrun_01HQ",
			runId: "owrun_01HQ",
			runIntent: "baseline",
			status: "completed",
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/official-web/runs?limit=20&siteId=www_muc_edu_cn&status=completed&ingestionDispatchStatus=queued&runIntent=hot",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("loads official web site detail and recent runs from the runtime seam", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				freshnessBacklog: {
					deletedPages: [
						{
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/deleted",
						},
					],
					duePages: [
						{
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/",
						},
					],
					failedFetchPages: [
						{
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/failure",
						},
					],
					hotPages: [
						{
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/2",
						},
					],
				},
				recentRuns: [
					{
						runId: "owrun_01HQ",
					},
				],
				freshnessSummary: {
					duePages: 7,
				},
				recentPageChanges: [
					{
						id: "owobs_01",
					},
				],
				site: {
					siteId: "www_muc_edu_cn",
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.getOne("officialWebSites", {
				id: "www_muc_edu_cn",
				meta: undefined,
				signal: undefined,
			}),
		).resolves.toMatchObject({
			data: {
				freshnessBacklog: {
					deletedPages: [
						expect.objectContaining({
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/deleted",
						}),
					],
				},
				freshnessSummary: expect.objectContaining({
					duePages: 7,
				}),
				id: "www_muc_edu_cn",
				recentPageChanges: [
					expect.objectContaining({
						id: "owobs_01",
					}),
				],
				recentRuns: [
					expect.objectContaining({
						id: "owrun_01HQ",
					}),
				],
				siteId: "www_muc_edu_cn",
			},
		});
	});

	it("loads official web run detail with page changes from the runtime seam", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				run: {
					pageChangeSummary: {
						changedPages: 1,
						failedFetchPages: 1,
					},
					pageChanges: [
						{
							id: "owobs_01",
						},
					],
					run: {
						runId: "owrun_01HQ",
						runIntent: "repair",
					},
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.getOne("officialWebRuns", {
				id: "owrun_01HQ",
				meta: undefined,
				signal: undefined,
			}),
		).resolves.toMatchObject({
			data: {
				id: "owrun_01HQ",
				pageChangeSummary: expect.objectContaining({
					changedPages: 1,
					failedFetchPages: 1,
				}),
				pageChanges: [
					expect.objectContaining({
						id: "owobs_01",
					}),
				],
				runIntent: "repair",
			},
		});
	});
}
