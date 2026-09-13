import { ChatConversationIdentifierSchema } from "campus-contracts/chat-conversations";
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
		const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
		return c.json(await input.client.list(query));
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
