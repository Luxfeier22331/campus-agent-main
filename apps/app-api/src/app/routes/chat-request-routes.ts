import { AppApiRouteError, jsonResponse } from "../../http";
import { requireSessionPrincipal } from "../principal";
import {
	createRouteErrorCorrelation,
	readJsonRequestBody,
	resolveWaitUntil,
} from "../request-utils";
import { routeChatErrorResponse } from "./chat-route-support";
import type { ChatRouteRegistrationInput } from "./chat-route-types";
import { createChatSseResponse } from "./chat-stream-responses";

export function registerChatRequestRoutes(input: ChatRouteRegistrationInput) {
	input.app.get("/api/chat/availability", async () => {
		const response = await input
			.createRequestScope()
			.resolveChatAvailabilityService()
			.getAvailability();
		return jsonResponse(response);
	});

	input.app.post("/api/chat/requests", async (c) => {
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
			const response = await scope.resolveChatCommandService().submit({
				idempotencyKey: c.req.header("idempotency-key") ?? null,
				payload: await readJsonRequestBody(c.req.raw),
				principal: resolved.principal,
				requestKind: "public_chat",
				waitUntil: resolveWaitUntil(c),
			});
			return jsonResponse(
				{
					answer: response.answer,
				},
				{
					headers: {
						"x-request-id": response.requestId,
					},
					status: 200,
				},
			);
		} catch (error) {
			const response = routeChatErrorResponse(error, routeErrorCorrelation);
			if (response) {
				return response;
			}
			throw error;
		}
	});

	input.app.post("/api/chat/requests/stream", async (c) => {
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
			const service = scope.resolveChatCommandService();
			if (!service.submitStream) {
				throw new AppApiRouteError({
					code: "dependency_not_ready",
					message: "Chat lifecycle stream is not configured.",
					retryable: true,
					status: 503,
				});
			}

			const iterator = service
				.submitStream({
					idempotencyKey: c.req.header("idempotency-key") ?? null,
					payload: await readJsonRequestBody(c.req.raw),
					principal: resolved.principal,
					requestKind: "public_chat",
					waitUntil: resolveWaitUntil(c),
				})
				[Symbol.asyncIterator]();
			const first = await iterator.next();
			if (first.done) {
				throw new AppApiRouteError({
					code: "empty_lifecycle_stream",
					message: "Chat lifecycle stream ended before emitting a request event.",
					retryable: true,
					status: 502,
				});
			}

			return createChatSseResponse({
				first: first.value,
				iterator,
			});
		} catch (error) {
			const response = routeChatErrorResponse(error, routeErrorCorrelation);
			if (response) {
				return response;
			}
			throw error;
		}
	});
}
