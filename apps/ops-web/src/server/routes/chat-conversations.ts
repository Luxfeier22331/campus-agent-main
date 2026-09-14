import {
	ChatConversationIdentifierSchema,
	OpsConversationListQuerySchema,
} from "campus-contracts/chat-conversations";
import type { Hono } from "hono";
import type { createChatConversationClient } from "../chat-conversation-client.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import { admitOpsApiRequest, jsonError } from "./http.ts";

export function registerChatConversationRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	client: ReturnType<typeof createChatConversationClient>;
}) {
	input.app.get("/api/ops/chat-conversations", async (c) => {
		const operator = await admitOpsApiRequest(input.admission, c.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = OpsConversationListQuerySchema.safeParse(c.req.query());
		if (!query.success) {
			return jsonError("OPS_INVALID_QUERY", "会话查询参数无效。", 400);
		}
		return c.json(await input.client.list(query.data));
	});

	input.app.get("/api/ops/chat-conversations/:conversationId", async (c) => {
		const operator = await admitOpsApiRequest(input.admission, c.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const id = ChatConversationIdentifierSchema.safeParse(c.req.param("conversationId"));
		if (!id.success) {
			return jsonError("OPS_INVALID_QUERY", "会话 ID 无效。", 400);
		}
		return c.json(await input.client.getDetail(id.data));
	});
}
