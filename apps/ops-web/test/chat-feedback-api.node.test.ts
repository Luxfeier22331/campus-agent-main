// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createChatFeedbackClient } from "../src/server/chat-feedback-client";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { createTestOpsApp } from "./helpers/ops-app";

const page = { items: [], nextCursor: null, counts: { total: 0, helpful: 0, unhelpful: 0 } };

describe("chat feedback Ops BFF and client", () => {
	it("admits operators and forwards the filters and internal token", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(Response.json(page));
		const client = createChatFeedbackClient(
			{ OPS_WEB_APP_API_URL: "http://app.internal", OPS_WEB_INTERNAL_TOKEN: "feedback-test-token" },
			{ fetchImplementation },
		);
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			chatFeedbackClient: client,
		});
		const response = await app.request(
			"http://ops.test/api/ops/chat-feedback?vote=unhelpful&requestId=req-1&limit=10",
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual(page);
		const [url, init] = fetchImplementation.mock.calls[0] ?? [];
		expect(new URL(url).pathname).toBe("/api/internal/admin/chat-feedback");
		expect(Object.fromEntries(new URL(url).searchParams)).toEqual({
			vote: "unhelpful",
			requestId: "req-1",
			limit: "10",
		});
		expect(init.headers).toEqual({ authorization: "Bearer feedback-test-token" });
	});
	it("rejects unadmitted requests before reading feedback", async () => {
		const client = { list: vi.fn(), getDetail: vi.fn() };
		const app = createTestOpsApp({
			chatFeedbackClient: client,
			admission: {
				admit: async () => ({
					operator: null,
					response: new Response("Unauthorized", { status: 401 }),
				}),
			},
		});
		for (const suffix of ["", "/fb-1"]) {
			expect((await app.request(`/api/ops/chat-feedback${suffix}`)).status).toBe(401);
		}
		expect(client.list).not.toHaveBeenCalled();
		expect(client.getDetail).not.toHaveBeenCalled();
	});
	it("rejects invalid queries and preserves upstream unavailable and not-found errors", async () => {
		const fetchImplementation = vi.fn();
		const client = createChatFeedbackClient(
			{ OPS_WEB_APP_API_URL: "http://app.internal", OPS_WEB_INTERNAL_TOKEN: "token" },
			{ fetchImplementation },
		);
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			chatFeedbackClient: client,
		});
		expect((await app.request("/api/ops/chat-feedback?limit=101")).status).toBe(400);
		expect(fetchImplementation).not.toHaveBeenCalled();
		fetchImplementation.mockResolvedValueOnce(
			Response.json(
				{ error: { code: "feedback_not_found", message: "该反馈已不可用。" } },
				{ status: 404 },
			),
		);
		const absent = await app.request("/api/ops/chat-feedback/fb-1");
		expect(absent.status).toBe(404);
		expect(absent.headers.get("cache-control")).toBe("no-store");
		fetchImplementation.mockRejectedValueOnce(new Error("connection failed"));
		expect((await app.request("/api/ops/chat-feedback")).status).toBe(503);
	});
});
