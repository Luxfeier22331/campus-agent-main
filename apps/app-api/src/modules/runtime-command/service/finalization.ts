import { toConversationResponse } from "../../chat";
import type { ToolExecutionResponse } from "../../integration";
import type { ChatAdmissionFailureFinalization } from "../admission-dispatcher";
import type { AcceptedDurableRequestCloseout } from "../store-types";
import { ChatFinalizationConflict } from "../store-types";
import type { ChatCommandServiceContext } from "./context";
import { sha256Text } from "./durable-metadata";
import { createPreAcceptError } from "./errors";
import { extractSourceDocIds } from "./normalize";
import { acceptedCloseoutContext } from "./product-finalization";
import { executionFinalizationErrorResponse } from "./stream";
import type { AcceptedChatCommandContext, ChatCommandResponse } from "./types";
import { buildFinalizedWrite } from "./writes";

export function admissionFailureFinalizationFingerprint(input: {
	errorCode: string;
	runId: string;
	workflowId: string;
}): string {
	return sha256Text(`${input.runId}\0admission_failed\0${input.workflowId}\0${input.errorCode}`);
}

export async function finalizeAcceptedCommand(
	service: ChatCommandServiceContext,
	input: {
		admissionFailureWorkflowId?: string;
		completedAt?: string;
		context: AcceptedChatCommandContext;
		durableAdmissionConfirmed?: boolean;
		executionResponse: ToolExecutionResponse;
		executionFinalizationReceivedAt?: string | null;
		finalizationFingerprint?: string;
		streamAppApiTtftMs?: number | null;
		transportError?: { code: string; retryable: boolean } | null;
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
		...(input.durableAdmissionConfirmed === undefined
			? {}
			: { durableAdmissionConfirmed: input.durableAdmissionConfirmed }),
		durationMs,
		principal: context.input.principal,
		projectionCloseoutMs,
		requestId: context.requestId,
		response: input.executionResponse,
		runId: context.runId,
		safetyIdentifier: context.safetyIdentifier,
		...(appApiStageTiming === undefined ? {} : { stageTiming: appApiStageTiming }),
		surface: context.surface,
		startedAt: context.acceptedAt,
		...(input.streamAppApiTtftMs === undefined
			? {}
			: { streamAppApiTtftMs: input.streamAppApiTtftMs }),
		traceId: context.traceId,
		turnSequence: context.turnSequence,
		userMessageId: context.userMessageId,
	});
	if (input.finalizationFingerprint) {
		finalized.write.finalizationFingerprint = input.finalizationFingerprint;
	}
	if (input.admissionFailureWorkflowId) {
		finalized.write.admissionFailure = {
			workflowId: input.admissionFailureWorkflowId,
		};
	}

	const result = await dependencies.commandStore.finalizeRequest(finalized.write);
	if (result.outcome === "applied") {
		await recordTransportError(service, {
			context,
			transportError: input.transportError ?? null,
		});
		const stageTiming = finalized.write.requestObservabilityFact.stageTiming;
		await telemetry?.recordRequestFinalized({
			conversationId: context.conversation.id,
			durationMs,
			errorCode: finalized.write.turnDispatch.errorCode,
			modelUsage: input.executionResponse.modelUsage,
			principalType: context.input.principal.principal.type,
			requestId: context.requestId,
			retryable: finalized.write.assistantMessage.retryable,
			safetyIdentifier: context.safetyIdentifier,
			sourceDocIds: extractSourceDocIds(input.executionResponse.result),
			...(stageTiming === undefined ? {} : { stageTiming }),
			status: finalized.write.turnDispatch.status as
				| "completed"
				| "error"
				| "needs_clarification"
				| "no_answer"
				| "approval_required"
				| "rejected"
				| "cancelled",
			surface: context.surface,
			traceId: context.traceId,
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
		runId: context.runId,
		safetyIdentifier: context.safetyIdentifier,
		surface: context.surface,
		startedAt: context.acceptedAt,
		traceId: context.traceId,
		turnSequence: context.turnSequence,
		userMessageId: context.userMessageId,
	});
	const conversation = await dependencies.conversationStore.getConversationByOwner(
		context.input.principal.principal.principalId,
		context.conversation.id,
	);
	if (
		!conversation?.messages.some(
			(message) =>
				message.role === "assistant" &&
				message.requestId === context.requestId &&
				message.runId === context.runId,
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

export async function finalizeAdmissionFailure(
	service: ChatCommandServiceContext,
	input: ChatAdmissionFailureFinalization,
): Promise<void> {
	const { dependencies, now } = service;
	const candidates = await dependencies.commandStore.listAcceptedDurableRequestsForCloseout({
		limit: 1,
		runId: input.runId,
	});
	const candidate = candidates[0];
	if (
		!candidate ||
		candidate.requestId !== input.requestId ||
		candidate.runId !== input.runId ||
		input.workflowId !== `campus-agent.chat.${input.runId}`
	) {
		throw new ChatFinalizationConflict();
	}
	const response = executionFinalizationErrorResponse({
		code: input.errorCode,
		message: "The request could not be admitted for durable execution.",
		retryable: false,
		traceId: candidate.traceId,
	});
	const finalizationFingerprint = admissionFailureFinalizationFingerprint(input);
	if (candidate.finalizationFingerprint || candidate.completedAt) {
		isExactFinalizationReplay(candidate, {
			completedAt: candidate.completedAt ?? "",
			finalizationFingerprint,
		});
		return;
	}
	await finalizeAcceptedCommand(service, {
		admissionFailureWorkflowId: input.workflowId,
		completedAt: now().toISOString(),
		context: acceptedCloseoutContext(candidate),
		executionResponse: response,
		finalizationFingerprint,
		transportError: { code: input.errorCode, retryable: false },
	});
}

export async function finalizeLocalCancellation(
	service: ChatCommandServiceContext,
	input: { completedAt: string; runId: string },
): Promise<{ outcome: "applied" | "replayed" }> {
	const { dependencies } = service;
	const candidates = await dependencies.commandStore.listAcceptedDurableRequestsForCloseout({
		limit: 1,
		runId: input.runId,
		startedBefore: input.completedAt,
	});
	const candidate = candidates[0];
	if (!candidate) {
		throw createPreAcceptError({
			code: "request_not_found",
			message: "Accepted chat request was not found for local cancellation.",
			status: 404,
		});
	}
	const response = executionFinalizationErrorResponse({
		code: "execution_cancelled",
		message: "The request was cancelled.",
		retryable: false,
		status: "cancelled",
		traceId: candidate.traceId,
	});
	const finalizationFingerprint = sha256Text(`${candidate.runId}\0${JSON.stringify(response)}`);
	if (
		isExactFinalizationReplay(candidate, {
			completedAt: input.completedAt,
			finalizationFingerprint,
		})
	) {
		return { outcome: "replayed" };
	}
	const finalized = await finalizeAcceptedCommand(service, {
		completedAt: input.completedAt,
		context: acceptedCloseoutContext(candidate),
		executionResponse: response,
		finalizationFingerprint,
	});
	return { outcome: finalized.outcome };
}

export async function applyProductFinalization(
	service: ChatCommandServiceContext,
	input: {
		completedAt: string;
		finalizationFingerprint: string;
		response: ToolExecutionResponse;
		runId: string;
	},
): Promise<{ outcome: "applied" | "replayed" }> {
	const { dependencies } = service;
	const candidates = await dependencies.commandStore.listAcceptedDurableRequestsForCloseout({
		limit: 1,
		runId: input.runId,
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
	if (input.response.traceId !== candidate.traceId) {
		throw new ChatFinalizationConflict();
	}
	if (isExactFinalizationReplay(candidate, input)) {
		return { outcome: "replayed" };
	}
	const finalized = await finalizeAcceptedCommand(service, {
		completedAt: input.completedAt,
		context: acceptedCloseoutContext(candidate),
		durableAdmissionConfirmed: true,
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

async function recordTransportError(
	service: ChatCommandServiceContext,
	input: {
		context: AcceptedChatCommandContext;
		transportError: { code: string; retryable: boolean } | null;
	},
): Promise<void> {
	if (!input.transportError) {
		return;
	}

	await service.telemetry?.recordRequestTransportError({
		conversationId: input.context.conversation.id,
		errorCode: input.transportError.code,
		principalType: input.context.input.principal.principal.type,
		requestId: input.context.requestId,
		safetyIdentifier: input.context.safetyIdentifier,
		retryable: input.transportError.retryable,
		surface: input.context.surface,
		traceId: input.context.traceId,
	});
}
