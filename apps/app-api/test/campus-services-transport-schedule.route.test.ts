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

describe("public campus services transport status route", () => {
	it("returns the current effective status projection from execution-control", async () => {
		const requests: Request[] = [];
		const app = createApp(env, {
			campusServicesTransportScheduleFetch: async (request) => {
				requests.push(request);
				return jsonResponse(
					{
						release: {
							releaseId: "transport-release-current",
							publishedAt: "2026-04-20T18:00:00+08:00",
							sourceRefs: ["https://portal.muc.edu.cn/notice/123"],
						},
						groups: [
							{
								kind: "daily",
								routes: [
									{
										routeId: "route:haidian-to-fengtai",
										displayName: "海淀校区→丰台校区",
										departures: [
											{
												departureTime: "07:00",
												kind: "teacher",
												status: "normal",
												sourceRefs: ["https://portal.muc.edu.cn/notice/123"],
											},
											{
												departureTime: "12:10",
												kind: "student",
												status: "changed",
												note: "该班次临时改至南门上车",
												sourceRefs: ["https://portal.muc.edu.cn/notice/456"],
											},
										],
									},
								],
							},
						],
					},
					{ etag: '"execution-control-status-etag"' },
				);
			},
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/campus-services/transport-schedule/status"),
		);
		const text = await response.text();
		const payload = JSON.parse(text);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
		expect(response.headers.get("etag")).toBe('"execution-control-status-etag"');
		expect(requests).toHaveLength(1);
		expect(requests[0].method).toBe("GET");
		expect(requests[0].headers.get("x-execution-query-auth")).toBe("query-secret");
		expect(new URL(requests[0].url).pathname).toBe(
			"/internal/projections/campus-services/transport-schedule/status",
		);
		expect(payload).toMatchObject({
			release: {
				releaseId: "transport-release-current",
				publishedAt: "2026-04-20T18:00:00+08:00",
				sourceRefs: ["https://portal.muc.edu.cn/notice/123"],
			},
			groups: [
				{
					kind: "daily",
					routes: [
						{
							routeId: "route:haidian-to-fengtai",
							displayName: "海淀校区→丰台校区",
							departures: [
								{
									departureTime: "07:00",
									kind: "teacher",
									status: "normal",
									sourceRefs: ["https://portal.muc.edu.cn/notice/123"],
								},
								{
									departureTime: "12:10",
									kind: "student",
									status: "changed",
									note: "该班次临时改至南门上车",
									sourceRefs: ["https://portal.muc.edu.cn/notice/456"],
								},
							],
						},
					],
				},
			],
		});
		expect(text).not.toContain("result_envelope");
	});

	it("fails closed when execution-control returns invalid status projection", async () => {
		const app = createApp(env, {
			campusServicesTransportScheduleFetch: async () =>
				jsonResponse({
					release: {
						releaseId: "transport-release-current",
						publishedAt: "2026-04-20T18:00:00+08:00",
						sourceRefs: ["https://portal.muc.edu.cn/notice/123"],
					},
					groups: [
						{
							kind: "daily",
							routes: [
								{
									routeId: "route:haidian-to-fengtai",
									displayName: "海淀校区→丰台校区",
									departures: [
										{
											departureTime: "07:00",
											kind: "teacher",
											status: "silently_normalized",
											sourceRefs: ["https://portal.muc.edu.cn/notice/123"],
										},
									],
								},
							],
						},
					],
				}),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/campus-services/transport-schedule/status"),
		);

		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "invalid_transport_status_projection",
			},
		});
	});
});

function jsonResponse(payload: unknown, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(payload), {
		headers: { "content-type": "application/json; charset=utf-8", ...headers },
	});
}
