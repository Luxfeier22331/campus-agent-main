import {
	ChatFeedbackIdentifierSchema,
	ChatFeedbackQuerySchema,
} from "campus-contracts/chat-feedback";
import type { Hono } from "hono";
import type { createChatFeedbackClient } from "../chat-feedback-client.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import { admitOpsApiRequest, jsonError, toSearchParams } from "./http.ts";

export function registerChatFeedbackRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	client: ReturnType<typeof createChatFeedbackClient>;
}) {
	input.app.get("/api/ops/chat-feedback", async (c) => {
		const operator = await admitOpsApiRequest(input.admission, c.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = ChatFeedbackQuerySchema.safeParse(c.req.query());
		if (!query.success) {
			return jsonError("OPS_INVALID_QUERY", "反馈查询参数无效。", 400);
		}
		return c.json(await input.client.list(toSearchParams(query.data)));
	});
	input.app.get("/api/ops/chat-feedback/:feedbackId", async (c) => {
		const operator = await admitOpsApiRequest(input.admission, c.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const id = ChatFeedbackIdentifierSchema.safeParse(c.req.param("feedbackId"));
		if (!id.success) {
			return jsonError("OPS_INVALID_QUERY", "反馈 ID 无效。", 400);
		}
		return c.json(await input.client.getDetail(id.data));
	});
}
