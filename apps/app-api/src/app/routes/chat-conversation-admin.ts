import {
	ChatConversationIdentifierSchema,
	OpsConversationListQuerySchema,
	OpsConversationListResponseSchema,
} from "campus-contracts/chat-conversations";
import type { Hono } from "hono";
import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse, withNoStore } from "../../http";
import type { AppRequestScope } from "../types";
import { requireOpsAdminToken } from "./ops-admin-auth";

export function registerChatConversationAdminRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
}) {
	input.app.get("/api/internal/admin/chat-conversations", async (c) => {
		requireOpsAdminToken(c.req.raw, input.env);
		const parsed = OpsConversationListQuerySchema.safeParse(c.req.query());
		if (!parsed.success) {
			throw new AppApiRouteError({
				code: "invalid_conversation_query",
				message: "会话查询参数无效。",
				status: 400,
				retryable: false,
			});
		}
		const result = await input
			.createRequestScope()
			.resolveOpsConversationQueryService()
			.listSummaries(parsed.data);
		return withNoStore(
			jsonResponse(
				OpsConversationListResponseSchema.parse({
					data: result.rows.map((row) => ({
						id: row.id,
						title: row.title,
						owner: { id: row.ownerId, displayName: row.displayName, email: row.ownerEmail ?? null },
						createdAt: row.createdAt.toISOString(),
						updatedAt: row.updatedAt.toISOString(),
						messageCount: Number(row.messageCount),
						turnCount: Number(row.turnCount),
						latestQuestionPreview: row.latestQuestion,
						latestAnswerPreview: row.latestAnswer,
						latestRequestId: row.latestRequestId,
						latestStatus: row.latestStatus,
						hasFailures: Boolean(row.hasFailures),
						hasFeedback: Boolean(row.hasFeedback),
					})),
					page: { nextCursor: result.nextCursor },
					generatedAt: new Date().toISOString(),
					filters: { from: parsed.data.from ?? null, to: parsed.data.to ?? null },
				}),
			),
		);
	});

	input.app.get("/api/internal/admin/chat-conversations/:conversationId", async (c) => {
		requireOpsAdminToken(c.req.raw, input.env);
		const id = ChatConversationIdentifierSchema.safeParse(c.req.param("conversationId"));
		if (!id.success) {
			throw new AppApiRouteError({
				code: "invalid_conversation_id",
				message: "会话 ID 无效。",
				status: 400,
				retryable: false,
			});
		}
		const detail = await input
			.createRequestScope()
			.resolveOpsConversationQueryService()
			.getDetail(id.data);
		if (!detail) {
			throw new AppApiRouteError({
				code: "conversation_not_found",
				message: "该会话已删除或不存在。",
				status: 404,
				retryable: false,
			});
		}
		return withNoStore(jsonResponse(detail));
	});
}
