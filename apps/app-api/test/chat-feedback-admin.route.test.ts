import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";

const headers = { authorization: "Bearer feedback-test-token" };
function setup() {
	const chatFeedbackQueryService = {
		list: vi.fn().mockResolvedValue({
			items: [],
			nextCursor: null,
			counts: { total: 0, helpful: 0, unhelpful: 0 },
		}),
		getDetail: vi.fn().mockResolvedValue(null),
	};
	return {
		service: chatFeedbackQueryService,
		app: createApp(
			{ DEPLOYMENT_ENVIRONMENT: "test", OPS_WEB_INTERNAL_TOKEN: "feedback-test-token" },
			{ chatFeedbackQueryService },
		),
	};
}

describe("Ops chat feedback routes", () => {
	it("requires the internal token for both reads", async () => {
		const { app, service } = setup();
		for (const path of ["", "/feedback-1"]) {
			expect((await app.request(`/api/internal/admin/chat-feedback${path}`)).status).toBe(401);
		}
		expect(service.list).not.toHaveBeenCalled();
		expect(service.getDetail).not.toHaveBeenCalled();
	});
	it("forwards filters and returns an uncached page", async () => {
		const { app, service } = setup();
		const response = await app.request(
			"/api/internal/admin/chat-feedback?vote=unhelpful&requestId=req-1&limit=10&from=2026-09-01T00:00:00Z",
			{ headers },
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toContain("no-store");
		expect(service.list).toHaveBeenCalledWith({
			vote: "unhelpful",
			requestId: "req-1",
			limit: 10,
			from: "2026-09-01T00:00:00Z",
		});
		expect(await response.json()).toMatchObject({ counts: { total: 0 } });
	});
	it.each([
		"vote=other",
		"limit=101",
		"limit=0",
		"from=bad",
		"from=2026-09-02T00:00:00Z&to=2026-09-01T00:00:00Z",
		"userId=user-1",
	])("rejects invalid query %s", async (query) => {
		const { app, service } = setup();
		expect(
			(await app.request(`/api/internal/admin/chat-feedback?${query}`, { headers })).status,
		).toBe(400);
		expect(service.list).not.toHaveBeenCalled();
	});
	it("returns 404 when feedback is withdrawn or hidden with its conversation", async () => {
		const { app, service } = setup();
		const response = await app.request("/api/internal/admin/chat-feedback/fb-1", { headers });
		expect(response.status).toBe(404);
		expect(service.getDetail).toHaveBeenCalledWith("fb-1");
	});
});
