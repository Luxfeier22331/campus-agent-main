import { describe, expect, it, vi } from "vitest";
import { createChatConversationClient } from "../src/server/chat-conversation-client";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { createTestOpsApp } from "./helpers/ops-app";

const conversation = {
	id: "conv-1",
	title: "会话",
	createdAt: "2026-09-01T00:00:00Z",
	updatedAt: "2026-09-01T00:00:00Z",
	activeRequestId: null,
	messages: [],
};
describe("Ops conversation API", () => {
	it("reads through App API with server authentication and no browser caching", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(Response.json(conversation));
		const client = createChatConversationClient(
			{ OPS_WEB_APP_API_URL: "http://app.internal", OPS_WEB_INTERNAL_TOKEN: "test-token" },
			{ fetchImplementation },
		);
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			chatConversationClient: client,
		});
		const response = await app.request("/api/ops/chat-conversations/conv-1");
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual(conversation);
		expect(fetchImplementation).toHaveBeenCalledWith(
			"http://app.internal/api/internal/admin/chat-conversations/conv-1",
			expect.objectContaining({ headers: { authorization: "Bearer test-token" } }),
		);
	});
	it("denies admission before calling App API and preserves upstream errors", async () => {
		const getDetail = vi.fn();
		const denied = createTestOpsApp({
			chatConversationClient: { getDetail, list: vi.fn() },
			admission: {
				admit: async () => ({
					operator: null,
					response: new Response("Unauthorized", { status: 401 }),
				}),
			},
		});
		expect((await denied.request("/api/ops/chat-conversations/conv-1")).status).toBe(401);
		expect(getDetail).not.toHaveBeenCalled();
		const fetchImplementation = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json(
					{ error: { code: "conversation_not_found", message: "该会话已删除或不存在。" } },
					{ status: 404 },
				),
			)
			.mockRejectedValueOnce(new Error("offline"));
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			chatConversationClient: createChatConversationClient(
				{ OPS_WEB_APP_API_URL: "http://app.internal", OPS_WEB_INTERNAL_TOKEN: "test-token" },
				{ fetchImplementation },
			),
		});
		const missing = await app.request("/api/ops/chat-conversations/conv-1");
		expect(missing.status).toBe(404);
		expect(missing.headers.get("cache-control")).toBe("no-store");
		expect((await app.request("/api/ops/chat-conversations/conv-1")).status).toBe(503);
	});
});
