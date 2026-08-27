import { toConversationResponse } from "../../chat";
import type { ToolExecutionResponse } from "../../integration";
import type { AcceptedDurableRequestCloseout } from "../store-types";
import { ChatFinalizationConflict } from "../store-types";
import type { ChatCommandServiceContext } from "./context";
import { createPreAcceptError } from "./errors";
import { acceptedCloseoutContext } from "./product-finalization";
import type { AcceptedChatCommandContext, ChatCommandResponse } from "./types";
import { buildFinalizedWrite } from "./writes";

export async function finalizeAcceptedCommand(
	service: ChatCommandServiceContext,
	input: {
		completedAt?: string;
		context: AcceptedChatCommandContext;
		executionResponse: ToolExecutionResponse;
		executionFinalizationReceivedAt?: string | null;
		finalizationFingerprint?: string;
		streamAppApiTtftMs?: number | null;
	},
) {
	const { dependencies, now, telemetry } = service;
	const { context } = input;
	const completedAt = input.completedAt ?? now().toISOString();
	const durationMs = Math.max(
		0,
		new Date(completedAt).valueOf() - new Date(context.acceptedAt).valueOf(),
	);
	const projectionCloseoutMs = input.executionFinalizationReceivedAt
		? Math.max(
				0,
				new Date(completedAt).valueOf() - new Date(input.executionFinalizationReceivedAt).valueOf(),
			)
		: null;
	const appApiStageTiming = await dependencies.observabilityStore.readRequestStageTiming(
		context.requestId,
	);
	const finalized = buildFinalizedWrite({
		assistantMessageId: context.assistantMessageId,
		branchId: context.branchId,
		completedAt,
		conversation: context.conversation,
		conversationTitle: context.conversationTitle,
		durationMs,
		principal: context.input.principal,
		projectionCloseoutMs,
		requestId: context.requestId,
		response: input.executionResponse,
		safetyIdentifier: context.safetyIdentifier,
		...(appApiStageTiming === undefined ? {} : { stageTiming: appApiStageTiming }),
		surface: context.surface,
		startedAt: context.acceptedAt,
		...(input.streamAppApiTtftMs === undefined
			? {}
			: { streamAppApiTtftMs: input.streamAppApiTtftMs }),
		turnSequence: context.turnSequence,
		userMessageId: context.userMessageId,
	});
	if (input.finalizationFingerprint) {
		finalized.write.finalizationFingerprint = input.finalizationFingerprint;
	}
	const result = await dependencies.commandStore.finalizeRequest(finalized.write);
	if (result.outcome === "applied") {
		telemetry?.configureRequestOutcome({
			errorCode: finalized.write.turnDispatch.errorCode,
			requestId: context.requestId,
			status: finalized.write.turnDispatch.status as
				| "completed"
				| "error"
				| "approval_required"
				| "rejected"
				| "cancelled",
			surface: context.surface,
		});
	}

	return {
		outcome: result.outcome,
		response: {
			...finalized.responseBody,
			answer: {
				conversation: toConversationResponse(result.conversation),
				result: finalized.responseBody.answer.result,
			},
		},
	};
}

export async function readProductFinalizedCommand(
	service: ChatCommandServiceContext,
	input: {
		context: AcceptedChatCommandContext;
		executionResponse: ToolExecutionResponse;
	},
): Promise<ChatCommandResponse> {
	const { dependencies, now } = service;
	const { context } = input;
	const completedAt = now().toISOString();
	const finalized = buildFinalizedWrite({
		assistantMessageId: context.assistantMessageId,
		branchId: context.branchId,
		completedAt,
		conversation: context.conversation,
		conversationTitle: context.conversationTitle,
		durationMs: Math.max(
			0,
			new Date(completedAt).valueOf() - new Date(context.acceptedAt).valueOf(),
		),
		principal: context.input.principal,
		requestId: context.requestId,
		response: input.executionResponse,
		safetyIdentifier: context.safetyIdentifier,
		surface: context.surface,
		startedAt: context.acceptedAt,
		turnSequence: context.turnSequence,
		userMessageId: context.userMessageId,
	});
	const conversation = await dependencies.conversationStore.getConversationByOwner(
		context.input.principal.principal.principalId,
		context.conversation.id,
	);
	if (
		!conversation?.messages.some(
			(message) => message.role === "assistant" && message.requestId === context.requestId,
		)
	) {
		throw createPreAcceptError({
			code: "product_finalization_missing",
			message: "Finalized conversation projection is unavailable.",
			retryable: true,
			status: 503,
		});
	}
	return {
		...finalized.responseBody,
		answer: {
			conversation: toConversationResponse(conversation),
			result: finalized.responseBody.answer.result,
		},
	};
}

export async function applyProductFinalization(
	service: ChatCommandServiceContext,
	input: {
		completedAt: string;
		finalizationFingerprint: string;
		response: ToolExecutionResponse;
		requestId: string;
	},
): Promise<{ outcome: "applied" | "replayed" }> {
	const { dependencies } = service;
	const candidates = await dependencies.commandStore.listAcceptedDurableRequestsForCloseout({
		limit: 1,
		requestId: input.requestId,
		startedBefore: input.completedAt,
	});
	const candidate = candidates[0];
	if (!candidate) {
		throw createPreAcceptError({
			code: "request_not_found",
			message: "Accepted chat request was not found for product finalization.",
			status: 404,
		});
	}
	if (isExactFinalizationReplay(candidate, input)) {
		return { outcome: "replayed" };
	}
	const finalized = await finalizeAcceptedCommand(service, {
		completedAt: input.completedAt,
		context: acceptedCloseoutContext(candidate),
		executionResponse: input.response,
		finalizationFingerprint: input.finalizationFingerprint,
	});
	return { outcome: finalized.outcome };
}

function isExactFinalizationReplay(
	candidate: AcceptedDurableRequestCloseout,
	input: { completedAt: string; finalizationFingerprint: string },
): boolean {
	if (!(candidate.finalizationFingerprint || candidate.completedAt)) {
		return false;
	}
	const recordedCompletedAt = candidate.completedAt
		? new Date(candidate.completedAt).valueOf()
		: Number.NaN;
	const requestedCompletedAt = new Date(input.completedAt).valueOf();
	if (
		!(
			candidate.finalizationFingerprint &&
			Number.isFinite(recordedCompletedAt) &&
			Number.isFinite(requestedCompletedAt)
		) ||
		candidate.finalizationFingerprint !== input.finalizationFingerprint ||
		recordedCompletedAt !== requestedCompletedAt
	) {
		throw new ChatFinalizationConflict();
	}
	return true;
}
