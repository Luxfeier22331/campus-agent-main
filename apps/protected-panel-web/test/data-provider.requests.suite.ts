import { expect, it, vi } from "vitest";

import { protectedPanelDataProvider } from "../src/panel/data-provider";
import { createJsonResponse, mockJsonFetch } from "./data-provider.test-support";

export function registerDataProviderRequestsSuite() {
	it("maps request list filters onto the protected same-site runtime seam", async () => {
		const fetchSpy = mockJsonFetch({
			page: {
				nextCursor: "cursor_02",
			},
			requests: [
				{
					answerPreview: "图书馆开放到 22:00。",
					completedAt: "2026-03-28T08:00:01.000Z",
					conversationId: "conv_01HQ",
					durationMs: 812,
					errorCode: null,
					principalId: "user_01HQ",
					principalLabel: "Jane Doe",
					principalType: "campus_member",
					projectedAt: "2026-03-28T08:00:02.000Z",
					questionPreview: "图书馆开放到几点？",
					requestId: "req_01HQ",
					requestedCapability: "knowledge",
					requestedScope: {
						collection: "student_rules",
						corpus: "regulations",
					},
					selectedTarget: "rag-agent",
					sourceDocIds: ["handbook:library-hours"],
					startedAt: "2026-03-28T08:00:00.000Z",
					status: "completed",
					surface: "public_chat_web",
					traceId: "trace_01HQ",
				},
			],
		});

		const response = await protectedPanelDataProvider.getList("requests", {
			filter: {
				q: "图书馆",
				status: "completed",
				surface: "public_chat_web",
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
			id: "req_01HQ",
			requestId: "req_01HQ",
			status: "completed",
		});
		expect(response.pageInfo).toEqual({
			hasNextPage: true,
			hasPreviousPage: false,
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/requests?limit=20&q=%E5%9B%BE%E4%B9%A6%E9%A6%86&status=completed&surface=public_chat_web",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("uses the stored cursor for sequential next-page navigation only", async () => {
		const fetchSpy = mockJsonFetch(
			{
				page: {
					nextCursor: "cursor_02",
				},
				requests: [
					{
						answerPreview: "图书馆开放到 22:00。",
						completedAt: "2026-03-28T08:00:01.000Z",
						conversationId: "conv_01HQ",
						durationMs: 812,
						errorCode: null,
						principalId: "user_01HQ",
						principalLabel: "Jane Doe",
						principalType: "campus_member",
						projectedAt: "2026-03-28T08:00:02.000Z",
						questionPreview: "图书馆开放到几点？",
						requestId: "req_01HQ",
						requestedCapability: "knowledge",
						requestedScope: null,
						selectedTarget: "rag-agent",
						sourceDocIds: [],
						startedAt: "2026-03-28T08:00:00.000Z",
						status: "completed",
						surface: "public_chat_web",
						traceId: "trace_01HQ",
					},
				],
			},
			{
				page: {
					nextCursor: null,
				},
				requests: [
					{
						answerPreview: null,
						completedAt: null,
						conversationId: "conv_01HQ",
						durationMs: null,
						errorCode: null,
						principalId: "user_01HQ",
						principalLabel: "Jane Doe",
						principalType: "campus_member",
						projectedAt: "2026-03-28T08:05:02.000Z",
						questionPreview: "宿舍门禁时间？",
						requestId: "req_02HQ",
						requestedCapability: "knowledge",
						requestedScope: null,
						selectedTarget: "rag-agent",
						sourceDocIds: [],
						startedAt: "2026-03-28T08:05:00.000Z",
						status: "accepted",
						surface: "public_chat_web",
						traceId: "trace_02HQ",
					},
				],
			},
		);

		await protectedPanelDataProvider.getList("requests", {
			filter: {
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

		const secondPage = await protectedPanelDataProvider.getList("requests", {
			filter: {
				status: "completed",
			},
			meta: undefined,
			pagination: {
				page: 2,
				perPage: 20,
			},
			signal: undefined,
			sort: {
				field: "startedAt",
				order: "DESC",
			},
		});

		expect(secondPage.pageInfo).toEqual({
			hasNextPage: false,
			hasPreviousPage: true,
		});
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			"/api/requests?limit=20&status=completed&cursor=cursor_02",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);

		await expect(
			protectedPanelDataProvider.getList("requests", {
				filter: {
					status: "completed",
				},
				meta: undefined,
				pagination: {
					page: 3,
					perPage: 20,
				},
				signal: undefined,
				sort: {
					field: "startedAt",
					order: "DESC",
				},
			}),
		).rejects.toMatchObject({
			status: 400,
		});
	});

	it("loads request detail and fails closed on unavailable cursor pages", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				request: {
					answerPreview: "图书馆开放到 22:00。",
					completedAt: "2026-03-28T08:00:01.000Z",
					conversationId: "conv_01HQ",
					diagnostics: {
						clarificationReason: null,
						noAnswerReason: "resolved_policy_clause_not_found",
						resolvedPolicyDocumentId: "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
						resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
						retrievedTitleSummary: ["中央民族大学本科学生国家奖学金评审办法"],
						rewrittenQuery:
							"中央民族大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
					},
					durationMs: 812,
					errorCode: null,
					principalId: "user_01HQ",
					principalLabel: "Jane Doe",
					principalType: "campus_member",
					projectedAt: "2026-03-28T08:00:02.000Z",
					questionPreview: "图书馆开放到几点？",
					requestId: "req_01HQ",
					requestedCapability: "knowledge",
					requestedScope: null,
					selectedTarget: "rag-agent",
					sourceDocIds: [],
					startedAt: "2026-03-28T08:00:00.000Z",
					status: "completed",
					surface: "public_chat_web",
					traceId: "trace_01HQ",
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.getOne("requests", {
				id: "req_01HQ",
				meta: undefined,
				signal: undefined,
			}),
		).resolves.toMatchObject({
			data: {
				diagnostics: {
					noAnswerReason: "resolved_policy_clause_not_found",
					resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
				},
				id: "req_01HQ",
			},
		});

		await expect(
			protectedPanelDataProvider.getList("requests", {
				filter: {},
				meta: undefined,
				pagination: {
					page: 2,
					perPage: 20,
				},
				signal: undefined,
				sort: {
					field: "startedAt",
					order: "DESC",
				},
			}),
		).rejects.toMatchObject({
			status: 400,
		});
	});

	it("encodes request path identifiers before calling protected detail seams", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				request: {
					answerPreview: null,
					completedAt: null,
					conversationId: "conv_01HQ",
					durationMs: null,
					errorCode: null,
					principalId: "user_01HQ",
					principalLabel: "Jane Doe",
					principalType: "campus_member",
					projectedAt: "2026-03-28T08:00:02.000Z",
					questionPreview: "路径编码测试",
					requestId: "req/01?debug=true#frag",
					requestedCapability: "knowledge",
					requestedScope: null,
					selectedTarget: "rag-agent",
					sourceDocIds: [],
					startedAt: "2026-03-28T08:00:00.000Z",
					status: "completed",
					surface: "public_chat_web",
					traceId: "trace_01HQ",
				},
			}),
		);

		await protectedPanelDataProvider.getOne("requests", {
			id: "req/01?debug=true#frag",
			meta: undefined,
			signal: undefined,
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/requests/req%2F01%3Fdebug%3Dtrue%23frag",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("encodes request observability path identifiers before calling protected seams", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({}));

		await protectedPanelDataProvider.getRequestObservability({
			requestId: "req/01?debug=true#frag",
			signal: undefined,
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/requests/req%2F01%3Fdebug%3Dtrue%23frag/observability",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});
}
