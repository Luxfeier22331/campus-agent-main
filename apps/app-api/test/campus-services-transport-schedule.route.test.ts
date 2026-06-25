// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET: "query-secret",
	EXECUTION_CONTROL_TIMEOUT_MS: "1000",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("public campus services transport schedule route", () => {
	it("returns a sanitized public schedule using execution-control structured query", async () => {
		const requests: Request[] = [];
		const app = createApp(env, {
			campusServicesTransportScheduleFetch: async (request) => {
				requests.push(request);
				const body = (await request.json()) as {
					route_selector?: { route_id?: string };
				};
				if (!body.route_selector) {
					return jsonResponse({
						query_text: "公开班车时刻表",
						intent: "timetable",
						outcome: "clarification_required",
						queried_time_anchor: "2026-06-24T09:00:00+08:00",
						candidate_routes: [
							{
								route: {
									route_id: "route:haidian-to-fengtai",
									display_name: "海淀校区→丰台校区",
									service_family: "intercampus_commute",
								},
							},
							{
								route: {
									route_id: "route:fengtai-to-haidian",
									display_name: "丰台校区→海淀校区",
									service_family: "intercampus_commute",
								},
							},
						],
					});
				}

				const routeId = body.route_selector.route_id;
				return jsonResponse({
					query_text: "公开班车时刻表",
					intent: "timetable",
					outcome: "resolved_current",
					resolved_route: {
						route_id: routeId,
						display_name:
							routeId === "route:haidian-to-fengtai" ? "海淀校区→丰台校区" : "丰台校区→海淀校区",
						service_family: "intercampus_commute",
					},
					queried_time_anchor: "2026-06-24T09:00:00+08:00",
					requested_service_date: "2026-06-24",
					service_status: "running",
					schedule_snapshot: {
						snapshot_id: "snapshot:bus:2026-03-20",
						published_at: "2026-03-20T00:00:00+08:00",
						source_ref: "https://portal.muc.edu.cn/notice/123",
					},
					operational_notices:
						routeId === "route:fengtai-to-haidian"
							? [
									{
										operational_comment: "丰台校区乘车点临时调整至南门外停车区",
										source_ref: "https://portal.muc.edu.cn/notice/456",
									},
								]
							: [],
					timetable_entries: [
						{
							departure_at:
								routeId === "route:haidian-to-fengtai"
									? "2026-06-24T07:00:00+08:00"
									: "2026-06-24T07:30:00+08:00",
							departure_kind: routeId === "route:haidian-to-fengtai" ? "teacher" : "student",
							departure_status: routeId === "route:haidian-to-fengtai" ? "normal" : "changed",
							origin_stop_ref: {
								stop_id:
									routeId === "route:haidian-to-fengtai"
										? "stop:haidian-east-gate"
										: "stop:fengtai-main-gate",
								display_name: routeId === "route:haidian-to-fengtai" ? "海淀校区" : "丰台校区",
							},
							destination_stop_ref: {
								stop_id:
									routeId === "route:haidian-to-fengtai"
										? "stop:fengtai-main-gate"
										: "stop:haidian-east-gate",
								display_name: routeId === "route:haidian-to-fengtai" ? "丰台校区" : "海淀校区",
							},
							operational_note:
								routeId === "route:fengtai-to-haidian" ? "该班次临时改至南门上车" : "",
							related_notice_refs:
								routeId === "route:fengtai-to-haidian"
									? ["https://portal.muc.edu.cn/notice/456"]
									: ["https://portal.muc.edu.cn/notice/123"],
						},
					],
					related_notice_refs: ["https://portal.muc.edu.cn/notice/123"],
					result_envelope: {
						raw: "must not leak",
					},
				});
			},
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/campus-services/transport-schedule?serviceDate=2026-06-24",
			),
		);
		const text = await response.text();
		const payload = JSON.parse(text);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
		expect(response.headers.get("etag")).toBe(
			'"campus-services-transport-schedule:2026-06-24:snapshot:bus:2026-03-20:2026-03-20T00:00:00+08:00"',
		);
		expect(requests).toHaveLength(3);
		expect(requests[0].headers.get("x-execution-query-auth")).toBe("query-secret");
		expect(new URL(requests[0].url).pathname).toBe(
			"/internal/query/campus-services/transport-schedule",
		);
		expect(payload).toMatchObject({
			serviceDate: "2026-06-24",
			status: "available",
			hasAdjustments: true,
			adjustmentCount: 2,
			routes: [
				{
					routeId: "route:haidian-to-fengtai",
					displayName: "海淀校区→丰台校区",
					origin: "海淀校区",
					destination: "丰台校区",
					status: "running",
					departures: [
						{
							id: "route:haidian-to-fengtai:2026-06-24T07:00:00+08:00",
							sequence: 1,
							departureTime: "07:00",
							type: "教师班次",
							status: "normal",
							note: null,
							sourceNoticeRefs: ["https://portal.muc.edu.cn/notice/123"],
						},
					],
				},
				{
					routeId: "route:fengtai-to-haidian",
					displayName: "丰台校区→海淀校区",
					origin: "丰台校区",
					destination: "海淀校区",
					status: "running",
					note: "丰台校区乘车点临时调整至南门外停车区",
					departures: [
						{
							id: "route:fengtai-to-haidian:2026-06-24T07:30:00+08:00",
							sequence: 1,
							departureTime: "07:30",
							type: "学生班次",
							status: "changed",
							note: "该班次临时改至南门上车",
							sourceNoticeRefs: [
								"https://portal.muc.edu.cn/notice/456",
								"https://portal.muc.edu.cn/notice/123",
							],
						},
					],
				},
			],
			notices: [
				{
					publishedAt: "2026-03-20T00:00:00+08:00",
					title: "班车时刻表来源",
					url: "https://portal.muc.edu.cn/notice/123",
				},
				{
					publishedAt: "2026-03-20T00:00:00+08:00",
					title: "班车时刻表来源",
					url: "https://portal.muc.edu.cn/notice/456",
				},
			],
		});
		expect(text).not.toContain("result_envelope");
		expect(text).not.toContain("must not leak");
	});

	it("rejects invalid serviceDate", async () => {
		const app = createApp(env);

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/campus-services/transport-schedule?serviceDate=2026-99-99",
			),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "validation_failed",
			},
		});
	});

	it("returns unavailable when structured query cannot verify current state", async () => {
		const app = createApp(env, {
			campusServicesTransportScheduleFetch: async () =>
				jsonResponse({
					query_text: "公开班车时刻表",
					intent: "timetable",
					outcome: "temporarily_unverifiable",
					queried_time_anchor: "2026-06-24T09:00:00+08:00",
					requested_service_date: "2026-06-24",
					service_status: "unknown",
					fail_close_reason: "source_truth_unavailable",
				}),
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/campus-services/transport-schedule?serviceDate=2026-06-24",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			serviceDate: "2026-06-24",
			status: "unavailable",
			routes: [],
		});
	});

	it("returns unavailable when execution-control returns invalid departure metadata", async () => {
		const app = createApp(env, {
			campusServicesTransportScheduleFetch: async (request) => {
				const body = (await request.json()) as {
					route_selector?: { route_id?: string };
				};
				if (!body.route_selector) {
					return jsonResponse({
						query_text: "公开班车时刻表",
						intent: "timetable",
						outcome: "resolved_current",
						resolved_route: {
							display_name: "海淀校区→丰台校区",
							route_id: "route:haidian-to-fengtai",
							service_family: "intercampus_commute",
						},
					});
				}
				return jsonResponse({
					query_text: "公开班车时刻表",
					intent: "timetable",
					outcome: "resolved_current",
					queried_time_anchor: "2026-06-24T09:00:00+08:00",
					resolved_route: {
						display_name: "海淀校区→丰台校区",
						route_id: "route:haidian-to-fengtai",
						service_family: "intercampus_commute",
					},
					schedule_snapshot: {
						published_at: "2026-03-20T00:00:00+08:00",
						snapshot_id: "snapshot:bus:2026-03-20",
						source_ref: "https://portal.muc.edu.cn/notice/123",
					},
					service_status: "running",
					timetable_entries: [
						{
							departure_at: "2026-06-24T07:00:00+08:00",
							departure_kind: "student",
							departure_status: "silently_normalized",
						},
					],
				});
			},
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/campus-services/transport-schedule?serviceDate=2026-06-24",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			serviceDate: "2026-06-24",
			status: "unavailable",
			routes: [],
		});
	});
});

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}
