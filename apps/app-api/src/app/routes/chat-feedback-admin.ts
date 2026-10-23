import {
	ChatFeedbackIdentifierSchema,
	ChatFeedbackQuerySchema,
} from "campus-contracts/chat-feedback";
import type { Hono } from "hono";
import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse, withNoStore } from "../../http";
import type { AppRequestScope } from "../types";
import { requireOpsAdminToken } from "./ops-admin-auth";

export function registerChatFeedbackAdminRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
}) {
	input.app.get("/api/internal/admin/chat-feedback", async (c) => {
		requireOpsAdminToken(c.req.raw, input.env);
		const parsed = ChatFeedbackQuerySchema.safeParse(c.req.query());
		if (!parsed.success) {
			throw new AppApiRouteError({
				code: "invalid_feedback_query",
				message: "反馈查询参数无效。",
				status: 400,
				retryable: false,
			});
		}
		const query = parsed.data;
		return withNoStore(
			jsonResponse(await input.createRequestScope().resolveChatFeedbackQueryService().list(query)),
		);
	});
	input.app.get("/api/internal/admin/chat-feedback/:feedbackId", async (c) => {
		requireOpsAdminToken(c.req.raw, input.env);
		const parsed = ChatFeedbackIdentifierSchema.safeParse(c.req.param("feedbackId"));
		if (!parsed.success) {
			throw new AppApiRouteError({
				code: "invalid_feedback_id",
				message: "反馈 ID 无效。",
				status: 400,
				retryable: false,
			});
		}
		const id = parsed.data;
		const detail = await input.createRequestScope().resolveChatFeedbackQueryService().getDetail(id);
		if (!detail) {
			throw new AppApiRouteError({
				code: "feedback_not_found",
				message: "该反馈已不可用。",
				status: 404,
				retryable: false,
			});
		}
		return withNoStore(jsonResponse(detail));
	});
}
