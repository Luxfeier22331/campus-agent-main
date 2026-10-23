import { AppApiRouteError, jsonResponse } from "../../http";
import { requireSessionPrincipal } from "../principal";
import { createRouteErrorCorrelation, readJsonRequestBody } from "../request-utils";
import { routeErrorResponseWithRouteErrorCorrelation } from "../responses";
import { readFeedbackReasonCodes, readFeedbackVote, requireObjectBody } from "./chat-route-support";
import type { ChatRouteRegistrationInput } from "./chat-route-types";

export function registerChatMessageRoutes(input: ChatRouteRegistrationInput) {
	input.app.put(
		"/api/chat/conversations/:conversationId/messages/:messageId/feedback",
		async (c) => {
			const scope = input.createRequestScope();
			const resolved = await requireSessionPrincipal({
				env: input.env,
				getPrincipal: input.getPrincipal,
				request: c.req.raw,
				scope,
			});
			if (resolved.response) {
				return resolved.response;
			}

			const routeErrorCorrelation = createRouteErrorCorrelation();
			try {
				const body = requireObjectBody(await readJsonRequestBody(c.req.raw));
				const reasonCodes = readFeedbackReasonCodes(body);
				const response = await scope.resolveChatConversationService().setMessageFeedback({
					conversationId: c.req.param("conversationId"),
					messageId: c.req.param("messageId"),
					principal: resolved.principal,
					...(reasonCodes ? { reasonCodes } : {}),
					vote: readFeedbackVote(body),
				});
				return jsonResponse(response);
			} catch (error) {
				if (error instanceof AppApiRouteError) {
					return routeErrorResponseWithRouteErrorCorrelation(error, routeErrorCorrelation);
				}
				throw error;
			}
		},
	);

	input.app.delete(
		"/api/chat/conversations/:conversationId/messages/:messageId/feedback",
		async (c) => {
			const scope = input.createRequestScope();
			const resolved = await requireSessionPrincipal({
				env: input.env,
				getPrincipal: input.getPrincipal,
				request: c.req.raw,
				scope,
			});
			if (resolved.response) {
				return resolved.response;
			}

			await scope.resolveChatConversationService().deleteMessageFeedback({
				conversationId: c.req.param("conversationId"),
				messageId: c.req.param("messageId"),
				principal: resolved.principal,
			});
			return new Response(null, { status: 204 });
		},
	);

	input.app.delete(
		"/api/chat/conversations/:conversationId/messages/:messageId/trailing",
		async (c) => {
			const scope = input.createRequestScope();
			const resolved = await requireSessionPrincipal({
				env: input.env,
				getPrincipal: input.getPrincipal,
				request: c.req.raw,
				scope,
			});
			if (resolved.response) {
				return resolved.response;
			}

			await scope.resolveChatConversationService().deleteTrailingMessages({
				conversationId: c.req.param("conversationId"),
				messageId: c.req.param("messageId"),
				principal: resolved.principal,
			});
			return new Response(null, { status: 204 });
		},
	);
}
