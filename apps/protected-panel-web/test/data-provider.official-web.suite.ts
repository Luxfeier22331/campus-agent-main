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
						ingestionExecutionErrorCode: "worker_timeout",
						ingestionExecutionErrorMessage: "Worker timed out while indexing artifacts.",
						ingestionExecutionRef: "ingexec_01HQ",
						ingestionExecutionStatus: "failed",
						ingestionExecutionUpdatedAt: "2026-03-29T08:18:00.000Z",
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
			ingestionExecutionErrorCode: "worker_timeout",
			ingestionExecutionRef: "ingexec_01HQ",
			ingestionExecutionStatus: "failed",
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

	it("returns an exact total for terminal official web run cursor pages", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				page: {
					nextCursor: null,
				},
				runs: [
					{
						artifacts: [],
						collectorVersion: "official-web-collector@0.1.0",
						configVersion: "git:abc1234",
						failureCount: 0,
						finishedAt: "2026-03-29T08:17:32.000Z",
						ingestionDispatchRef: null,
						ingestionDispatchStatus: "dispatched",
						ingestionExecutionErrorCode: null,
						ingestionExecutionErrorMessage: null,
						ingestionExecutionRef: null,
						ingestionExecutionStatus: "pending",
						ingestionExecutionUpdatedAt: null,
						lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
						projectedAt: "2026-03-29T08:17:33.000Z",
						runId: "owrun_01HQ",
						runIntent: "baseline",
						siteId: "www_muc_edu_cn",
						startedAt: "2026-03-29T08:00:01.000Z",
						status: "completed",
						summary: null,
					},
					{
						artifacts: [],
						collectorVersion: "official-web-collector@0.1.0",
						configVersion: "git:abc1234",
						failureCount: 0,
						finishedAt: "2026-03-29T07:17:32.000Z",
						ingestionDispatchRef: null,
						ingestionDispatchStatus: "dispatched",
						ingestionExecutionErrorCode: null,
						ingestionExecutionErrorMessage: null,
						ingestionExecutionRef: null,
						ingestionExecutionStatus: "pending",
						ingestionExecutionUpdatedAt: null,
						lastHeartbeatAt: "2026-03-29T07:05:00.000Z",
						projectedAt: "2026-03-29T07:17:33.000Z",
						runId: "owrun_02HQ",
						runIntent: "hot",
						siteId: "www_muc_edu_cn",
						startedAt: "2026-03-29T07:00:01.000Z",
						status: "completed",
						summary: null,
					},
				],
			}),
		);

		await expect(
			protectedPanelDataProvider.getList("officialWebRuns", {
				filter: {},
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
			}),
		).resolves.toMatchObject({
			data: [{ id: "owrun_01HQ" }, { id: "owrun_02HQ" }],
			pageInfo: {
				hasNextPage: false,
				hasPreviousPage: false,
			},
			total: 2,
		});
	});

	it("returns an exact total for official web site lists", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				sites: [
					{
						displayName: "Www Muc Edu Cn",
						hostRoots: ["www.muc.edu.cn"],
						lastFailureAt: null,
						lastSuccessAt: "2026-03-29T08:17:32.000Z",
						latestCollectorVersion: "official-web-collector@0.1.0",
						latestConfigVersion: "git:abc1234",
						latestIngestionDispatchStatus: "dispatched",
						latestIngestionExecutionErrorCode: null,
						latestIngestionExecutionStatus: "pending",
						latestIngestionExecutionUpdatedAt: null,
						latestRunId: "owrun_01HQ",
						latestRunStatus: "completed",
						projectedAt: "2026-03-29T08:17:33.000Z",
						siteId: "www_muc_edu_cn",
					},
				],
			}),
		);

		await expect(
			protectedPanelDataProvider.getList("officialWebSites", {
				filter: {},
				meta: undefined,
				pagination: {
					page: 1,
					perPage: 50,
				},
				signal: undefined,
				sort: {
					field: "siteId",
					order: "ASC",
				},
			}),
		).resolves.toMatchObject({
			data: [{ id: "www_muc_edu_cn" }],
			pageInfo: {
				hasNextPage: false,
				hasPreviousPage: false,
			},
			total: 1,
		});
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
					latestIngestionExecutionErrorCode: "worker_timeout",
					latestIngestionExecutionStatus: "failed",
					latestIngestionExecutionUpdatedAt: "2026-03-29T08:18:00.000Z",
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
				latestIngestionExecutionErrorCode: "worker_timeout",
				latestIngestionExecutionStatus: "failed",
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
						ingestionExecutionErrorCode: null,
						ingestionExecutionErrorMessage: null,
						ingestionExecutionRef: "ingexec_01HQ",
						ingestionExecutionStatus: "completed",
						ingestionExecutionUpdatedAt: "2026-03-29T08:18:00.000Z",
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
				ingestionExecutionRef: "ingexec_01HQ",
				ingestionExecutionStatus: "completed",
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

	it("encodes official web detail path identifiers before calling protected seams", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				createJsonResponse({
					freshnessBacklog: {
						deletedPages: [],
						duePages: [],
						failedFetchPages: [],
						hotPages: [],
					},
					freshnessSummary: {
						changedLast24h: 0,
						deletedPages: 0,
						duePages: 0,
						failedFetchPages: 0,
						hotPages: 0,
						repairPages: 0,
						totalPages: 0,
					},
					recentPageChanges: [],
					recentRuns: [],
					site: {
						displayName: "Encoded Site",
						hostRoots: ["www.muc.edu.cn"],
						lastFailureAt: null,
						lastSuccessAt: null,
						latestCollectorVersion: null,
						latestConfigVersion: null,
						latestIngestionDispatchStatus: null,
						latestIngestionExecutionErrorCode: null,
						latestIngestionExecutionStatus: null,
						latestIngestionExecutionUpdatedAt: null,
						latestRunId: null,
						latestRunStatus: null,
						projectedAt: "2026-03-29T08:17:33.000Z",
						siteId: "site/01?debug=true#frag",
					},
				}),
			)
			.mockResolvedValueOnce(
				createJsonResponse({
					run: {
						pageChangeSummary: {},
						pageChanges: [],
						run: {
							artifacts: [],
							collectorVersion: null,
							configVersion: null,
							failureCount: 0,
							finishedAt: null,
							ingestionDispatchRef: null,
							ingestionDispatchStatus: "queued",
							ingestionExecutionErrorCode: null,
							ingestionExecutionErrorMessage: null,
							ingestionExecutionRef: null,
							ingestionExecutionStatus: "pending",
							ingestionExecutionUpdatedAt: null,
							lastHeartbeatAt: null,
							projectedAt: "2026-03-29T08:17:33.000Z",
							runId: "run/01?debug=true#frag",
							runIntent: "baseline",
							siteId: "site_01",
							startedAt: "2026-03-29T08:00:01.000Z",
							status: "accepted",
							summary: null,
						},
					},
				}),
			);

		await protectedPanelDataProvider.getOne("officialWebSites", {
			id: "site/01?debug=true#frag",
			meta: undefined,
			signal: undefined,
		});
		await protectedPanelDataProvider.getOne("officialWebRuns", {
			id: "run/01?debug=true#frag",
			meta: undefined,
			signal: undefined,
		});

		expect(fetchSpy).toHaveBeenNthCalledWith(
			1,
			"/api/official-web/sites/site%2F01%3Fdebug%3Dtrue%23frag",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			"/api/official-web/runs/run%2F01%3Fdebug%3Dtrue%23frag",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});
}
