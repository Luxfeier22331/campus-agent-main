import type { DiningMenuItem, DiningReview } from "@campus-agent/dining/domain";
import type { Page, Route } from "@playwright/test";
import { mapPageManifest } from "../../test/fixtures/map-manifest";
import { fulfillDiningFloorplan, fulfillDiningMap } from "./dining-mocks";
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
const campusGroupsCatalog = {
	schemaVersion: "campus-groups-catalog.v1",
	sections: [
		{
			groups: [
				{
					id: "qq-879596093",
					joinUrl: null,
					name: "夜之瞳音游群",
					qqGroupNumber: "879596093",
					summary: "挂靠夜之瞳",
					tags: ["音游"],
				},
				{
					id: "qq-300321279",
					joinUrl: null,
					name: "极上引诱会所",
					qqGroupNumber: "300321279",
					summary: "",
					tags: ["音游"],
				},
				...Array.from({ length: 12 }, (_, index) => ({
					id: `qq-test-${String(index).padStart(2, "0")}`,
					joinUrl: null,
					name: `测试群 ${index + 1}`,
					qqGroupNumber: String(900000000 + index),
					summary: "测试目录条目",
					tags: ["测试"],
				})),
			],
			id: "acgn",
			name: "ACGN",
		},
		{
			groups: [
				{
					id: "qq-760540871",
					joinUrl: null,
					name: "王佐体育运动学校",
					qqGroupNumber: "760540871",
					summary: "",
					tags: ["赛马娘"],
				},
				{
					id: "qq-720518745",
					joinUrl: null,
					name: "LML民大峡谷之巅推免交流群",
					qqGroupNumber: "720518745",
					summary: "已阵亡",
					tags: ["LOL"],
				},
				...Array.from({ length: 18 }, (_, index) => ({
					id: `qq-test-${String(index + 12).padStart(2, "0")}`,
					joinUrl: null,
					name: `测试群 ${index + 13}`,
					qqGroupNumber: String(900000012 + index),
					summary: "测试目录条目",
					tags: ["测试"],
				})),
			],
			id: "online-games",
			name: "线上游戏",
		},
		{
			groups: [
				{
					id: "qq-284874509",
					joinUrl: null,
					name: "民大重型群",
					qqGroupNumber: "284874509",
					summary: "",
					tags: ["重型乐队"],
				},
				{
					id: "qq-863056472",
					joinUrl: null,
					name: "夜之瞳麻将群",
					qqGroupNumber: "863056472",
					summary: "主要是日麻",
					tags: ["麻将"],
				},
				{
					id: "discord-muc-community",
					joinUrl: "https://discord.gg/XgQqU9zrPZ",
					name: "Discord",
					qqGroupNumber: null,
					summary: "请务必注意保护个人信息安全。",
					tags: ["中央民族大学Discord交流群"],
				},
				...Array.from({ length: 18 }, (_, index) => ({
					id: `qq-test-${String(index + 30).padStart(2, "0")}`,
					joinUrl: null,
					name: `测试群 ${index + 31}`,
					qqGroupNumber: String(900000030 + index),
					summary: "测试目录条目",
					tags: ["测试"],
				})),
			],
			id: "interest-groups",
			name: "同好群",
		},
	],
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
		renameFailure?: boolean;
		searchUnauthorized?: boolean;
	};
	diningFailures?: {
		floorplanFailure?: boolean;
		mapFailure?: boolean;
		menuFailure?: boolean;
		reviewFailure?: boolean;
	};
	emptyDiningMenu?: boolean;
	emptyDiningMap?: boolean;
	emptyMapPlaces?: boolean;
	mapPlacesFailure?: boolean;
	requests?: CampusApiRequestRecord[];
	sessionState?: CampusApiSessionState;
}

export interface CampusApiRequestRecord {
	body: unknown;
	headers: Record<string, string>;
	method: string;
	path: string;
	search: string;
}

export interface CampusApiSessionState {
	authenticated: boolean;
	unavailable?: boolean;
}

export async function mockCampusApi(page: Page, options: CampusApiMockOptions = {}) {
	const sessionState = options.sessionState ?? { authenticated: options.authenticated ?? true };
	const diningState = createDiningApiState();
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
				headers: request.headers(),
				method,
				path,
				search: url.search,
			});

			const mock = routeMocks({ diningState, options, sessionState }).find((candidate) => {
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

export async function fulfillChatStream(
	route: Route,
	input: {
		answerText?: string;
		delayMs?: number;
		terminal?: "cancelled" | "completed";
	} = {},
) {
	const body = parseRequestJson(route);
	const prompt = typeof body.prompt === "string" ? body.prompt : "校园问题";
	const conversationId =
		typeof body.conversationId === "string" && body.conversationId.trim()
			? body.conversationId
			: "conv_e2e";
	const answerText = input.answerText ?? resolveAnswerText(prompt);
	if (input.delayMs) {
		await new Promise((resolve) => setTimeout(resolve, input.delayMs));
	}
	const userMessage = chatMessage({
		conversationId,
		id: "msg_user_e2e",
		role: "user",
		text: prompt,
	});
	const conversation = (messages: ReturnType<typeof chatMessage>[]) => ({
		archivedAt: null,
		createdAt: now,
		id: conversationId,
		messages,
		pinnedAt: null,
		title: prompt,
		updatedAt: now,
	});
	const terminalEvent =
		input.terminal === "cancelled"
			? sse("request.cancelled", {
					answer: {
						conversation: conversation([userMessage]),
						result: {
							errorCode: "execution_cancelled",
							kind: "error",
							message: "The request was cancelled.",
							requestId: "req_e2e",
							retryable: false,
							traceId: "trace_e2e",
						},
					},
					occurredAt: now,
					requestId: "req_e2e",
					runId: "run_e2e",
					sequence: 3,
					status: "cancelled",
					traceId: "trace_e2e",
				})
			: sse("request.completed", {
					answer: {
						conversation: conversation([
							userMessage,
							chatMessage({
								conversationId,
								id: "msg_assistant_e2e",
								kind: "answer",
								role: "assistant",
								text: answerText,
							}),
						]),
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
				});
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
				delta: answerText,
				messageId: "msg_assistant_e2e",
				occurredAt: now,
				requestId: "req_e2e",
				runId: "run_e2e",
				sequence: 2,
				status: "running",
				traceId: "trace_e2e",
			}),
			terminalEvent,
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
		json: {
			error: { code: "execution_failed", message: "请求失败。", retryable: false },
		},
		status: 500,
	});
}

function routeMocks(input: {
	diningState: DiningApiState;
	options: CampusApiMockOptions;
	sessionState: CampusApiSessionState;
}): RouteMockInput[] {
	const { diningState, options, sessionState } = input;
	return [
		{
			method: "GET",
			path: "/campus-map/manifest.json",
			response: (route) =>
				route.fulfill({ contentType: "application/json", json: mapPageManifest, status: 200 }),
		},
		{
			method: "GET",
			path: /^\/campus-map\/assets\/[0-9a-f]{64}\.geojson$/,
			response: (route) =>
				route.fulfill({
					contentType: "application/geo+json",
					json: { features: [], type: "FeatureCollection" },
					status: 200,
				}),
		},
		{
			method: "GET",
			path: "/api/campus-groups/catalog",
			response: (route) =>
				route.fulfill({ contentType: "application/json", json: campusGroupsCatalog, status: 200 }),
		},
		{
			method: "GET",
			path: "/api/auth/get-session",
			response: (route) => {
				if (sessionState.unavailable) {
					return route.fulfill({
						contentType: "application/json",
						json: {
							error: {
								code: "dependency_not_ready",
								message: "账号服务暂时不可用。",
							},
						},
						status: 503,
					});
				}
				return route.fulfill({
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
					status: 202,
				});
			},
		},
		{
			method: "GET",
			path: "/api/auth/list-accounts",
			response: (route) =>
				route.fulfill({
					contentType: "application/json",
					json: sessionState.authenticated
						? [
								{
									accountId: "user_e2e",
									createdAt: now,
									id: "account_e2e",
									providerId: "credential",
									scopes: [],
									updatedAt: now,
									userId: "user_e2e",
								},
							]
						: { error: { code: "session_required", message: "请先登录。" } },
					status: sessionState.authenticated ? 200 : 401,
				}),
		},
		{
			method: "GET",
			path: "/api/auth/list-sessions",
			response: (route) =>
				route.fulfill({
					contentType: "application/json",
					json: sessionState.authenticated
						? [
								{
									createdAt: now,
									expiresAt: "2026-07-30T08:00:00.000Z",
									id: "session_e2e",
									ipAddress: "127.0.0.1",
									token: "session_token_e2e",
									updatedAt: now,
									userAgent:
										"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
									userId: "user_e2e",
								},
							]
						: { error: { code: "session_required", message: "请先登录。" } },
					status: sessionState.authenticated ? 200 : 401,
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
				options.conversationFailures?.renameFailure
					? route.fulfill({
							contentType: "application/json",
							json: { error: { code: "rename_failed", message: "重命名失败。" } },
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
			path: mapPageManifest.placesUrl,
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
			path: "/api/dining",
			response: (route) =>
				options.diningFailures?.mapFailure
					? route.fulfill({
							contentType: "application/json",
							json: { error: { code: "dining_unavailable", message: "unavailable" } },
							status: 500,
						})
					: fulfillDiningMap(route, {
							empty: options.emptyDiningMap,
						}),
		},
		{
			method: "GET",
			path: /^\/api\/dining\/windows\/[^/]+\/menu$/,
			response: (route) => {
				if (options.diningFailures?.menuFailure) {
					return route.fulfill({
						contentType: "application/json",
						json: { error: { code: "dining_menu_unavailable", message: "unavailable" } },
						status: 500,
					});
				}
				const windowId = decodePathSegment(route, -2);
				return route.fulfill({
					contentType: "application/json",
					json: {
						items: options.emptyDiningMenu ? [] : (diningState.menuByWindow.get(windowId) ?? []),
						windowId,
					},
					status: 200,
				});
			},
		},
		{
			method: "GET",
			path: /^\/api\/dining\/menu-items\/[^/]+\/reviews$/,
			response: (route) => {
				if (options.diningFailures?.reviewFailure) {
					return route.fulfill({
						contentType: "application/json",
						json: { error: { code: "dining_reviews_unavailable", message: "unavailable" } },
						status: 500,
					});
				}
				const menuItemId = decodePathSegment(route, -2);
				const items = (diningState.reviewsByMenuItem.get(menuItemId) ?? []).map((review) => ({
					...review,
					canDelete: sessionState.authenticated && diningState.ownReviewIds.has(review.reviewId),
					canReport:
						sessionState.authenticated &&
						!diningState.ownReviewIds.has(review.reviewId) &&
						!review.hasReported,
				}));
				return route.fulfill({
					contentType: "application/json",
					json: { items, nextCursor: null },
					status: 200,
				});
			},
		},
		{
			method: "POST",
			path: /^\/api\/dining\/menu-items\/[^/]+\/reviews$/,
			response: (route) => {
				const menuItemId = decodePathSegment(route, -2);
				const body = parseRequestJson(route);
				const review: DiningReview = {
					anonymous: body.anonymous === true,
					authorName: body.anonymous === true ? null : "测试用户",
					body: parseStringField(body, "body") ?? "",
					canDelete: true,
					canReport: false,
					createdAt: now,
					edited: false,
					hasReported: false,
					menuItemId,
					reviewId: `review_created_${diningState.nextReviewSequence++}`,
				};
				diningState.ownReviewIds.add(review.reviewId);
				const reviews = diningState.reviewsByMenuItem.get(menuItemId) ?? [];
				reviews.unshift(review);
				diningState.reviewsByMenuItem.set(menuItemId, reviews);
				return route.fulfill({ contentType: "application/json", json: review, status: 201 });
			},
		},
		{
			method: "DELETE",
			path: /^\/api\/dining\/reviews\/[^/]+$/,
			response: (route) => {
				const reviewId = decodePathSegment(route, -1);
				for (const [menuItemId, reviews] of diningState.reviewsByMenuItem) {
					diningState.reviewsByMenuItem.set(
						menuItemId,
						reviews.filter((review) => review.reviewId !== reviewId),
					);
				}
				return route.fulfill({ status: 204 });
			},
		},
		{
			method: "POST",
			path: /^\/api\/dining\/reviews\/[^/]+\/reports$/,
			response: (route) => {
				const reviewId = decodePathSegment(route, -2);
				for (const reviews of diningState.reviewsByMenuItem.values()) {
					const review = reviews.find((candidate) => candidate.reviewId === reviewId);
					if (review) {
						review.hasReported = true;
						review.canReport = false;
					}
				}
				return route.fulfill({
					contentType: "application/json",
					json: { reportId: "report_e2e" },
					status: 201,
				});
			},
		},
		{
			method: "GET",
			path: /^\/api\/dining\/floorplans\/[0-9a-f]{64}\.svg$/,
			response: (route) =>
				options.diningFailures?.floorplanFailure
					? route.fulfill({
							contentType: "image/svg+xml",
							body: "",
							status: 500,
						})
					: fulfillDiningFloorplan(route),
		},
	];
}

interface DiningApiState {
	menuByWindow: Map<string, DiningMenuItem[]>;
	nextReviewSequence: number;
	ownReviewIds: Set<string>;
	reviewsByMenuItem: Map<string, DiningReview[]>;
}

function createDiningApiState(): DiningApiState {
	const menuItemId = "dmi_lanzhou_beef_noodles";
	return {
		menuByWindow: new Map([
			[
				"haidian:haidian-1f:window-1",
				[
					{ menuItemId, name: "牛肉面", priceText: "12 元", sortOrder: 0 },
					{ menuItemId: "dmi_cold_noodles", name: "凉面", priceText: null, sortOrder: 1 },
				],
			],
		]),
		nextReviewSequence: 1,
		ownReviewIds: new Set(["review_own"]),
		reviewsByMenuItem: new Map([
			[
				menuItemId,
				[
					{
						anonymous: false,
						authorName: "测试用户",
						body: "汤底很香，分量合适。",
						canDelete: true,
						canReport: false,
						createdAt: now,
						edited: false,
						hasReported: false,
						menuItemId,
						reviewId: "review_own",
					},
					{
						anonymous: true,
						authorName: null,
						body: "中午排队时间不长。",
						canDelete: false,
						canReport: true,
						createdAt: now,
						edited: false,
						hasReported: false,
						menuItemId,
						reviewId: "review_other",
					},
				],
			],
		]),
	};
}

function decodePathSegment(route: Route, index: number): string {
	const segment = new URL(route.request().url()).pathname.split("/").at(index) ?? "";
	return decodeURIComponent(segment);
}

function resolveConversationSearchResults(input: { query: string; view: string }) {
	if (input.view === "archived" && input.query.includes("奖学金")) {
		return [toConversationSearchResult(archivedConversation)];
	}
	if (input.query.includes("图书馆")) {
		return [toConversationSearchResult(libraryConversation)];
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

function toConversationSearchResult(conversation: typeof historyConversation) {
	return {
		...toConversationSummary(conversation),
		matchSnippet: null,
	};
}

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
