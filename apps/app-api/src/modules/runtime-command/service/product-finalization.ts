import type { AcceptedDurableRequestCloseout } from "../store-types";
import type { AcceptedChatCommandContext } from "./types";

export function acceptedCloseoutContext(
	candidate: AcceptedDurableRequestCloseout,
): AcceptedChatCommandContext {
	return {
		acceptedAt: candidate.acceptedAt,
		assistantMessageId: candidate.assistantMessageId,
		branchId: candidate.conversation.activeBranchId ?? "branch_active",
		conversation: candidate.conversation,
		conversationTitle: candidate.conversationTitle,
		idempotencyKey: candidate.idempotencyKey,
		input: {
			payload: {
				conversationId: candidate.conversation.id,
				prompt: candidate.questionPreview,
			},
			principal: candidate.principal,
			requestKind: "public_chat",
		},
		memorySnapshot: null,
		requestFingerprintSha256: candidate.requestFingerprintSha256,
		requestId: candidate.requestId,
		runId: candidate.runId,
		runPhase: null,
		safetyIdentifier: candidate.safetyIdentifier,
		surface: candidate.surface,
		traceId: candidate.traceId,
		turnId: null,
		turnSequence: candidate.turnSequence,
		userMessageId: candidate.userMessageId,
		validatedPayload: {
			conversationId: candidate.conversation.id,
			prompt: candidate.questionPreview,
		},
	};
}
