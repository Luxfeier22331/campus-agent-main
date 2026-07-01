import type { Page, Route } from "@playwright/test";
import { fulfillDiningFloor } from "./dining-mocks";
import { installMapLibreMock } from "./maplibre-mock";

const now = "2026-06-30T08:00:00.000Z";
const historyConversation = {
	archivedAt: null,
	createdAt: now,
	id: "conv_history_e2e",
	messages: [
		chatMessage({
			conversationId: "conv_history_e2e",
			id: "msg_history_user",
			role: "user",
			text: "国家奖学金怎么评审？",
		}),
		chatMessage({
			conversationId: "conv_history_e2e",
			id: "msg_history_answer",
			kind: "answer",
			role: "assistant",
			text: "历史记录中的国家奖学金回答。",
		}),
	],
	pinnedAt: null,
	title: "国家奖学金",
	updatedAt: now,
};
const libraryConversation = {
	archivedAt: null,
	createdAt: now,
	id: "conv_library_e2e",
	messages: [
		chatMessage({
			conversationId: "conv_library_e2e",
			id: "msg_library_user",
			role: "user",
			text: "图书馆开放时间？",
		}),
		chatMessage({
			conversationId: "conv_library_e2e",
			id: "msg_library_answer",
			kind: "answer",
			role: "assistant",
			text: "图书馆开放时间以馆方公告为准。",
		}),
	],
	pinnedAt: null,
	title: "图书馆开放时间",
	updatedAt: now,
};
const archivedConversation = {
	archivedAt: now,
	createdAt: now,
	id: "conv_archived_e2e",
	messages: [
		chatMessage({
			conversationId: "conv_archived_e2e",
			id: "msg_archived_user",
			role: "user",
			text: "奖学金历史材料？",
		}),
		chatMessage({
			conversationId: "conv_archived_e2e",
			id: "msg_archived_answer",
			kind: "answer",
			role: "assistant",
			text: "已归档会话中的奖学金材料回答。",
		}),
	],
	pinnedAt: null,
	title: "归档奖学金材料",
	updatedAt: now,
};

interface RouteMockInput {
	method?: string;
	path: string | RegExp;
	response: (route: Route) => Promise<void> | void;
}

interface CampusApiMockOptions {
	authenticated?: boolean;
	conversationFailures?: {
		archiveFailure?: boolean;
		deleteFailure?: boolean;
		detailUnauthorized?: boolean;
		searchUnauthorized?: boolean;
	};
	diningFailures?: {
		floorFailure?: boolean;
		hallsFailure?: boolean;
		reviewsFailure?: boolean;
	};
	emptyDiningHalls?: boolean;
	emptyMapPlaces?: boolean;
	mapPlacesFailure?: boolean;
	requests?: CampusApiRequestRecord[];
	sessionState?: CampusApiSessionState;
	transportFailures?: {
		statusFailure?: boolean;
	};
}

export interface CampusApiRequestRecord {
	body: unknown;
	method: string;
	path: string;
	search: string;
}

export interface CampusApiSessionState {
	authenticated: boolean;
}

export async function mockCampusApi(page: Page, options: CampusApiMockOptions = {}) {
	const sessionState = options.sessionState ?? { authenticated: options.authenticated ?? true };
	await installMapLibreMock(page);
	await page.route(
		(url) => url.pathname.startsWith("/api/"),
		async (route) => {
			const request = route.request();
			const url = new URL(request.url());
			const path = url.pathname;
			const method = request.method();
			options.requests?.push({
				body: method === "GET" || method === "HEAD" ? null : parseRequestJson(route),
				method,
				path,
				search: url.search,
			});

			const mock = routeMocks({ options, sessionState }).find((candidate) => {
				if (candidate.method && candidate.method !== method) {
					return false;
				}
				return typeof candidate.path === "string"
					? candidate.path === path
					: candidate.path.test(path);
			});

			if (mock) {
				await mock.response(route);
				return;
			}

			await route.fulfill({
				contentType: "application/json",
				json: { error: { code: "not_found", message: "Mock API route not found." } },
				status: 404,
			});
		},
	);
}

export async function fulfillChatStream(route: Route, input: { delayMs?: number } = {}) {
	const body = parseRequestJson(route);
	const prompt = typeof body.prompt === "string" ? body.prompt : "校园问题";
	const conversationId =
		typeof body.conversationId === "string" && body.conversationId.trim()
			? body.conversationId
			: "conv_e2e";
	const answerText = resolveAnswerText(prompt);
	if (input.delayMs) {
		await new Promise((resolve) => setTimeout(resolve, input.delayMs));
	}
	await route.fulfill({
		body: [
			sse("request.accepted", {
				occurredAt: now,
				requestId: "req_e2e",
				runId: "run_e2e",
				sequence: 1,
				status: "accepted",
				traceId: "trace_e2e",
			}),
			sse("answer.delta", {
				accumulatedText: answerText,
				messageId: "msg_assistant_e2e",
				occurredAt: now,
				requestId: "req_e2e",
				runId: "run_e2e",
				sequence: 2,
				status: "running",
				traceId: "trace_e2e",
			}),
			sse("request.completed", {
				answer: {
					conversation: {
						archivedAt: null,
						createdAt: now,
						id: conversationId,
						messages: [
							chatMessage({
								conversationId,
								id: "msg_user_e2e",
								role: "user",
								text: prompt,
							}),
							chatMessage({
								conversationId,
								id: "msg_assistant_e2e",
								kind: "answer",
								role: "assistant",
								text: answerText,
							}),
						],
						pinnedAt: null,
						title: prompt,
						updatedAt: now,
					},
					result: {
						kind: "answer",
						requestId: "req_e2e",
						text: answerText,
						traceId: "trace_e2e",
					},
				},
				occurredAt: now,
				requestId: "req_e2e",
				runId: "run_e2e",
				sequence: 3,
				status: "completed",
				traceId: "trace_e2e",
			}),
		].join(""),
		contentType: "text/event-stream",
		status: 200,
	});
}

export async function fulfillChatFailedStream(route: Route) {
	await route.fulfill({
		body: [
			sse("request.accepted", {
				occurredAt: now,
				requestId: "req_failed_e2e",
				runId: "run_failed_e2e",
				sequence: 1,
				status: "accepted",
				traceId: "trace_failed_e2e",
			}),
			sse("request.failed", {
				error: {
					code: "execution_failed",
					message: "请求失败。",
					retryable: true,
				},
				occurredAt: now,
				requestId: "req_failed_e2e",
				runId: "run_failed_e2e",
				sequence: 2,
				status: "failed",
				traceId: "trace_failed_e2e",
			}),
		].join(""),
		contentType: "text/event-stream",
		status: 200,
	});
}

export async function fulfillChatFailure(route: Route) {
	await route.fulfill({
		contentType: "application/json",
		json: { error: { code: "execution_failed", message: "请求失败。" } },
		status: 500,
	});
}

function routeMocks(input: {
	options: CampusApiMockOptions;
	sessionState: CampusApiSessionState;
}): RouteMockInput[] {
	const { options, sessionState } = input;
	return [
		{
			method: "GET",
			path: "/api/auth/get-session",
			response: (route) =>
				route.fulfill({
					contentType: "application/json",
					json: sessionState.authenticated
						? {
								session: {
									createdAt: now,
									expiresAt: "2026-07-30T08:00:00.000Z",
									id: "session_e2e",
									token: "session_token_e2e",
									updatedAt: now,
									userId: "user_e2e",
								},
								user: {
									email: "student@example.edu",
									id: "user_e2e",
									name: "测试用户",
								},
							}
						: null,
					status: 200,
				}),
		},
		{
			method: "GET",
			path: "/api/chat/conversations",
			response: (route) => {
				const view = new URL(route.request().url()).searchParams.get("view");
				const conversations = view === "archived" ? [archivedConversation] : [historyConversation];
				return route.fulfill({
					contentType: "application/json",
					json: sessionState.authenticated
						? {
								conversations: conversations.map(toConversationSummary),
							}
						: { error: { code: "session_required", message: "请先登录。" } },
					status: sessionState.authenticated ? 200 : 401,
				});
			},
		},
		{
			method: "GET",
			path: "/api/chat/conversations/search",
			response: (route) => {
				if (options.conversationFailures?.searchUnauthorized) {
					return route.fulfill({
						contentType: "application/json",
						json: { error: { code: "session_required", message: "请先登录。" } },
						status: 401,
					});
				}
				const query = new URL(route.request().url()).searchParams.get("q") ?? "";
				const view = new URL(route.request().url()).searchParams.get("view") ?? "active";
				return route.fulfill({
					contentType: "application/json",
					json: {
						conversations: resolveConversationSearchResults({ query, view }),
						query,
					},
					status: 200,
				});
			},
		},
		{
			method: "GET",
			path: /^\/api\/chat\/conversations\/[^/]+$/,
			response: (route) => {
				if (options.conversationFailures?.detailUnauthorized) {
					return route.fulfill({
						contentType: "application/json",
						json: { error: { code: "session_required", message: "请先登录。" } },
						status: 401,
					});
				}
				const conversationId = decodeURIComponent(
					new URL(route.request().url()).pathname.split("/").at(-1) ?? "",
				);
				const conversation = resolveConversationDetail(conversationId);
				return route.fulfill({
					contentType: "application/json",
					json: sessionState.authenticated
						? { conversation }
						: { error: { code: "session_required", message: "请先登录。" } },
					status: sessionState.authenticated ? 200 : 401,
				});
			},
		},
		{
			method: "PATCH",
			path: /^\/api\/chat\/conversations\/[^/]+$/,
			response: (route) =>
				route.fulfill({
					contentType: "application/json",
					json: { conversation: toConversationSummary(historyConversation) },
					status: 200,
				}),
		},
		{
			method: "DELETE",
			path: /^\/api\/chat\/conversations\/[^/]+\/messages\/[^/]+\/trailing$/,
			response: (route) =>
				route.fulfill({
					contentType: "application/json",
					json: { ok: true },
					status: 200,
				}),
		},
		{
			method: "DELETE",
			path: /^\/api\/chat\/conversations\/[^/]+$/,
			response: (route) =>
				options.conversationFailures?.deleteFailure
					? route.fulfill({
							contentType: "application/json",
							json: { error: { code: "delete_failed", message: "删除失败。" } },
							status: 500,
						})
					: route.fulfill({
							contentType: "application/json",
							json: { ok: true },
							status: 200,
						}),
		},
		{
			method: "POST",
			path: /^\/api\/chat\/conversations\/[^/]+\/archive$/,
			response: (route) =>
				options.conversationFailures?.archiveFailure
					? route.fulfill({
							contentType: "application/json",
							json: { error: { code: "archive_failed", message: "归档失败。" } },
							status: 500,
						})
					: route.fulfill({
							contentType: "application/json",
							json: { conversation: toConversationSummary(historyConversation) },
							status: 200,
						}),
		},
		{
			method: "DELETE",
			path: /^\/api\/chat\/conversations\/[^/]+\/archive$/,
			response: (route) =>
				route.fulfill({
					contentType: "application/json",
					json: { conversation: toConversationSummary(historyConversation) },
					status: 200,
				}),
		},
		{
			method: "POST",
			path: /^\/api\/chat\/conversations\/[^/]+\/pin$/,
			response: (route) =>
				route.fulfill({
					contentType: "application/json",
					json: { conversation: toConversationSummary(historyConversation) },
					status: 200,
				}),
		},
		{
			method: "DELETE",
			path: /^\/api\/chat\/conversations\/[^/]+\/pin$/,
			response: (route) =>
				route.fulfill({
					contentType: "application/json",
					json: { conversation: toConversationSummary(historyConversation) },
					status: 200,
				}),
		},
		{
			method: "POST",
			path: "/api/feedback",
			response: (route) =>
				route.fulfill({
					contentType: "application/json",
					json: {
						feedback: {
							category: "experience_issue",
							feedbackId: "feedback_e2e",
							receivedAt: now,
							routeContext: parseStringField(parseRequestJson(route), "routeContext") ?? "/",
							status: "received",
						},
					},
					status: 200,
				}),
		},
		{
			method: "POST",
			path: "/api/chat/conversations",
			response: (route) =>
				route.fulfill({
					contentType: "application/json",
					json: {
						conversation: {
							archivedAt: null,
							createdAt: now,
							id: "conv_e2e",
							messages: [],
							pinnedAt: null,
							title: "新对话",
							updatedAt: now,
						},
					},
					status: 200,
				}),
		},
		{
			method: "POST",
			path: "/api/chat/requests/stream",
			response: (route) =>
				sessionState.authenticated
					? fulfillChatStream(route)
					: route.fulfill({
							contentType: "application/json",
							json: { error: { code: "session_required", message: "请先登录。" } },
							status: 401,
						}),
		},
		{
			method: "POST",
			path: /^\/api\/chat\/runs\/[^/]+\/cancel$/,
			response: (route) =>
				route.fulfill({
					contentType: "application/json",
					json: { ok: true },
					status: 200,
				}),
		},
		{
			method: "GET",
			path: "/api/campus-services/transport-schedule/status",
			response: (route) =>
				options.transportFailures?.statusFailure
					? route.fulfill({
							contentType: "application/json",
							json: { error: { code: "transport_unavailable", message: "unavailable" } },
							status: 500,
						})
					: route.fulfill({
							contentType: "application/json",
							json: {
								groups: [
									{
										kind: "weekday",
										routes: [
											{
												departures: [
													{
														departureTime: "07:30",
														kind: "student",
														note: "工作日运行",
														sourceRefs: ["https://example.edu/transport"],
														status: "normal",
													},
												],
												displayName: "海淀校区 -> 丰台校区",
												routeId: "haidian-fengtai",
											},
										],
									},
								],
								release: {
									publishedAt: now,
									releaseId: "transport_e2e",
									sourceRefs: ["https://example.edu/transport"],
								},
							},
							status: 200,
						}),
		},
		{
			method: "GET",
			path: "/api/campus-map/places",
			response: (route) =>
				options.mapPlacesFailure
					? route.fulfill({
							contentType: "application/json",
							json: { error: { code: "map_unavailable", message: "unavailable" } },
							status: 500,
						})
					: route.fulfill({
							contentType: "application/json",
							json: {
								campus: {
									defaultCenter: [116.3216, 39.9519],
									id: "haidian",
									name: "海淀校区",
								},
								places: options.emptyMapPlaces
									? []
									: [
											campusMapPlace({
												campus: "海淀校区",
												category: "building",
												coordinates: [120.1234, 39.9524],
												id: "library",
												tags: ["学习", "教学"],
												title: "图书馆",
											}),
											campusMapPlace({
												campus: "海淀校区",
												category: "service",
												coordinates: [116.3212, 39.9525],
												id: "student-service",
												tags: ["服务"],
												title: "学生事务中心",
											}),
											campusMapPlace({
												campus: "丰台校区",
												category: "transport",
												coordinates: [116.11303405, 39.80722115],
												id: "fengtai-east-gate",
												tags: ["出入口", "交通"],
												title: "丰台东门",
											}),
											campusMapPlace({
												campus: "丰台校区",
												category: "service",
												coordinates: [116.1132, 39.8073],
												id: "fengtai-huixian-canteen",
												tags: ["食堂"],
												title: "荟贤食堂",
											}),
										],
							},
							status: 200,
						}),
		},
		{
			method: "GET",
			path: "/api/dining/halls",
			response: (route) =>
				options.diningFailures?.hallsFailure
					? route.fulfill({
							contentType: "application/json",
							json: { error: { code: "dining_unavailable", message: "unavailable" } },
							status: 500,
						})
					: route.fulfill({
							contentType: "application/json",
							json: {
								halls: options.emptyDiningHalls
									? []
									: [
											{
												campus: "海淀校区",
												floors: [{ floorId: "haidian-canteen-1-1f", label: "一层" }],
												hallId: "haidian-canteen-1",
												name: "海淀一食堂",
											},
											{
												campus: "丰台校区",
												floors: [
													{ floorId: "fengtai-huixian-canteen-1f", label: "一层" },
													{ floorId: "fengtai-huixian-canteen-2f", label: "二层" },
												],
												hallId: "fengtai-huixian-canteen",
												name: "荟贤食堂",
											},
										],
							},
							status: 200,
						}),
		},
		{
			method: "GET",
			path: /^\/api\/dining\/halls\/[^/]+\/floors\/[^/]+$/,
			response: (route) =>
				options.diningFailures?.floorFailure
					? route.fulfill({
							contentType: "application/json",
							json: { error: { code: "floor_unavailable", message: "unavailable" } },
							status: 500,
						})
					: fulfillDiningFloor(route),
		},
		{
			method: "GET",
			path: /^\/api\/dining\/halls\/[^/]+\/reviews$/,
			response: (route) =>
				options.diningFailures?.reviewsFailure
					? route.fulfill({
							contentType: "application/json",
							json: { error: { code: "reviews_unavailable", message: "unavailable" } },
							status: 500,
						})
					: route.fulfill({
							contentType: "application/json",
							json: {
								reviews: [
									{
										campus: "海淀校区",
										comment: "汤底稳定，午餐时段排队较短。",
										contributorName: "测试同学",
										dishName: "金汤鱼粉",
										hallId: "haidian-canteen-1",
										hallName: "海淀一食堂",
										images: [],
										paidPriceLabel: "18 元",
										rating: 4,
										reviewId: "review_fish",
										sourceRecordId: "source_review_fish",
										stallName: "鱼粉",
									},
								],
							},
							status: 200,
						}),
		},
	];
}

function resolveConversationSearchResults(input: { query: string; view: string }) {
	if (input.view === "archived" && input.query.includes("奖学金")) {
		return [toConversationSummary(archivedConversation)];
	}
	if (input.query.includes("图书馆")) {
		return [toConversationSummary(libraryConversation)];
	}
	return [];
}

function resolveConversationDetail(conversationId: string) {
	if (conversationId === libraryConversation.id) {
		return libraryConversation;
	}
	if (conversationId === archivedConversation.id) {
		return archivedConversation;
	}
	return historyConversation;
}

function resolveAnswerText(prompt: string): string {
	if (prompt.includes("继续说明")) {
		return "续问回答会沿用当前历史会话上下文。";
	}
	if (prompt.includes("编辑后的问题")) {
		return "编辑后的问题已经重新生成回答。";
	}
	return "国家奖学金评审材料以学校正式通知为准。";
}

function parseRequestJson(route: Route): Record<string, unknown> {
	try {
		const payload = route.request().postDataJSON();
		return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function parseStringField(input: Record<string, unknown>, field: string): string | null {
	const value = input[field];
	return typeof value === "string" ? value : null;
}

function campusMapPlace(input: {
	campus: "丰台校区" | "海淀校区";
	category: "building" | "gate" | "landmark" | "service" | "transport";
	coordinates: [number, number];
	id: string;
	tags: string[];
	title: string;
}) {
	return {
		accessNote: null,
		campus: input.campus,
		category: input.category,
		description: `${input.campus}${input.title}`,
		geojson: {
			geometry: { coordinates: input.coordinates, type: "Point" },
			properties: { category: input.category, placeId: input.id, title: input.title },
			type: "Feature",
		},
		id: input.id,
		sourceRefs: [`campus-map:e2e:${input.id}`],
		tags: input.tags,
		title: input.title,
	};
}

function chatMessage(input: {
	conversationId: string;
	id: string;
	kind?: "answer" | null;
	role: "assistant" | "user";
	text: string;
}) {
	return {
		conversationId: input.conversationId,
		createdAt: now,
		id: input.id,
		kind: input.kind ?? null,
		requestId: "req_e2e",
		retryable: null,
		role: input.role,
		structuredParts: [],
		text: input.text,
	};
}

function toConversationSummary(conversation: typeof historyConversation) {
	return {
		archivedAt: conversation.archivedAt,
		createdAt: conversation.createdAt,
		id: conversation.id,
		pinnedAt: conversation.pinnedAt,
		title: conversation.title,
		updatedAt: conversation.updatedAt,
	};
}

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
