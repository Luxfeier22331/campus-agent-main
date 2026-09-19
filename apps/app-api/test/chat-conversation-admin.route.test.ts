const timeMetadata = {
	generatedAt: "2026-09-17T04:00:00.000Z",
	filters: { from: "2026-09-16T16:00:00.000Z", to: "2026-09-17T04:00:00.000Z" },
};

import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";

const headers = { authorization: "Bearer conversation-test-token" };
function setup() {
	const service = {
		listSummaries: vi.fn().mockResolvedValue({ rows: [], nextCursor: null, ...timeMetadata }),
		getDetail: vi.fn().mockResolvedValue(null),
	};
	const app = createApp(
		{ DEPLOYMENT_ENVIRONMENT: "test", OPS_WEB_INTERNAL_TOKEN: "conversation-test-token" },
		{ opsConversationQueryService: service },
	);
	return { app, service };
}
describe("Ops conversation read route", () => {
	it.each(["COMPLETED", "RUNNING", "PENDING", "FAILED", "ACTION_REQUIRED", "CANCELLED"])(
		"preserves %s in the list response",
		async (status) => {
			const { app, service } = setup();
			service.listSummaries.mockResolvedValue({
				...timeMetadata,
				rows: [
					{
						id: "conv-1",
						title: "问题",
						ownerId: "user-1",
						displayName: null,
						createdAt: new Date("2026-09-01T00:00:00Z"),
						updatedAt: new Date("2026-09-01T00:00:00Z"),
						messageCount: 2,
						turnCount: 1,
						latestQuestion: "问题",
						latestAnswer: "回答",
						latestRequestId: "req-1",
						latestStatus: status,
						hasFailures: false,
						hasFeedback: true,
					},
				],
				nextCursor: null,
			});
			const response = await app.request(
				`/api/internal/admin/chat-conversations?status=${status}`,
				{
					headers,
				},
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				data: Array<{ id: string; latestRequestId: string }>;
			};
			expect(body.data[0]).toMatchObject({
				id: "conv-1",
				latestRequestId: "req-1",
				latestStatus: status,
			});
			expect(service.listSummaries).toHaveBeenCalled();
		},
	);

	it.each(["true", "false"])("passes hasFailures=%s to the query service", async (value) => {
		const { app, service } = setup();
		const response = await app.request(
			`/api/internal/admin/chat-conversations?hasFailures=${value}`,
			{ headers },
		);
		expect(response.status).toBe(200);
		expect(service.listSummaries).toHaveBeenCalledWith(
			expect.objectContaining({ hasFailures: value === "true" }),
		);
	});
	it("rejects invalid failure filters before querying", async () => {
		const { app, service } = setup();
		const response = await app.request("/api/internal/admin/chat-conversations?hasFailures=no", {
			headers,
		});
		expect(response.status).toBe(400);
		expect(service.listSummaries).not.toHaveBeenCalled();
	});

	it("requires internal authentication before reading", async () => {
		const { app, service } = setup();
		expect((await app.request("/api/internal/admin/chat-conversations/conv-1")).status).toBe(401);
		expect(service.getDetail).not.toHaveBeenCalled();
	});
	it("returns the saved conversation without caching", async () => {
		const { app, service } = setup();
		const detail = {
			id: "conv-1",
			title: "会话",
			createdAt: "2026-09-01T00:00:00Z",
			updatedAt: "2026-09-01T00:00:00Z",
			activeRequestId: null,
			messages: [],
		};
		service.getDetail.mockResolvedValue(detail);
		const response = await app.request("/api/internal/admin/chat-conversations/conv-1", {
			headers,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toContain("no-store");
		expect(await response.json()).toEqual(detail);
		expect(service.getDetail).toHaveBeenCalledWith("conv-1");
	});
	it("returns 404 for deleted or missing conversations", async () => {
		const { app } = setup();
		const response = await app.request("/api/internal/admin/chat-conversations/conv-absent", {
			headers,
		});
		expect(response.status).toBe(404);
		expect(response.headers.get("cache-control")).toContain("no-store");
	});
	it("rejects an invalid identifier", async () => {
		const { app, service } = setup();
		expect(
			(await app.request(`/api/internal/admin/chat-conversations/${"c".repeat(201)}`, { headers }))
				.status,
		).toBe(400);
		expect(service.getDetail).not.toHaveBeenCalled();
	});
});
