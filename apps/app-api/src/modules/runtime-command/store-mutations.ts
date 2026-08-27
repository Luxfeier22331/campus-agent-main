import type { conversations, messages, sessionSlots } from "../../db/schema";
import type {
	AcceptRequestWrite,
	FinalizeRequestWrite,
	FinalizeTurnDispatchWrite,
	FrozenDurableRunWrite,
	RequestObservabilityFactWrite,
	TurnDispatchMemorySnapshot,
	TurnDispatchWrite,
} from "./store-types";

export function buildConversationSeedInsertValues(
	seed: NonNullable<AcceptRequestWrite["conversationSeed"]>,
): typeof conversations.$inferInsert {
	return {
		id: seed.id,
		ownerUserId: seed.ownerUserId,
		title: seed.title,
		createdAt: new Date(seed.createdAt),
		updatedAt: new Date(seed.updatedAt),
	};
}

export function buildChatMessageInsertValues(
	input: AcceptRequestWrite["userMessage"] | FinalizeRequestWrite["assistantMessage"],
): typeof messages.$inferInsert {
	return {
		id: input.id,
		conversationId: input.conversationId,
		role: input.role,
		kind: input.kind ?? null,
		text: input.text,
		structuredPartsJson: input.structuredParts,
		createdAt: new Date(input.createdAt),
		requestId: input.requestId ?? null,
		retryable: input.retryable ?? null,
		parentMessageId: input.parentMessageId ?? null,
		branchId: input.branchId ?? "branch_active",
		turnSequence: input.turnSequence ?? 0,
		isActiveBranchHead: input.isActiveBranchHead ?? false,
	};
}

export function buildAcceptTurnDispatchInsertValues(
	input: TurnDispatchWrite,
	memorySnapshot: TurnDispatchMemorySnapshot | null,
	frozenRun: FrozenDurableRunWrite,
) {
	return {
		assistantMessageId: input.assistantMessageId,
		requestId: input.requestId,
		conversationId: input.conversationId,
		userMessageId: input.userMessageId,
		turnSequence: input.turnSequence,
		surface: input.surface,
		ownerUserId: input.ownerUserId,
		actorUserId: input.actorUserId,
		principalSnapshotJson: input.principalSnapshot,
		memoryRecallEnabled: memorySnapshot?.recallEnabled ?? null,
		memoryAppendEnabled: memorySnapshot?.appendEnabled ?? null,
		memoryOwnerGeneration: memorySnapshot?.ownerGeneration ?? null,
		memoryOwnerSequence: memorySnapshot?.ownerSequence ?? null,
		idempotencyKey: input.idempotencyKey,
		requestFingerprintSha256: input.requestFingerprintSha256,
		executionInputJson: frozenRun.executionInputJson,
		executionInputSha256: frozenRun.executionInputSha256,
		safetyIdentifier: input.safetyIdentifier ?? null,
		status: input.status,
		errorCode: null,
		completedAt: null,
		createdAt: new Date(input.createdAt),
		updatedAt: new Date(input.updatedAt),
	};
}

export function buildFinalizeTurnDispatchUpdateValues(input: FinalizeTurnDispatchWrite) {
	return {
		status: input.status,
		errorCode: input.errorCode,
		safetyIdentifier: input.safetyIdentifier ?? null,
		completedAt: input.completedAt ? new Date(input.completedAt) : null,
		updatedAt: new Date(input.updatedAt),
	};
}

function buildRequestObservabilityFactRecord(input: RequestObservabilityFactWrite) {
	return {
		aclAnomalyCode: input.aclAnomalyCode,
		aclDecision: input.aclDecision,
		completedAt: input.completedAt ? new Date(input.completedAt) : null,
		conversationId: input.conversationId,
		durationMs: input.durationMs,
		entitlementSnapshotId: input.entitlementSnapshotId,
		errorCode: input.errorCode,
		failClosed: input.failClosed,
		stageTimingJson: input.stageTiming ?? {},
		measuredAt: new Date(input.measuredAt),
		modelName: input.modelName,
		modelProvider: input.modelProvider,
		policyReason: input.policyReason,
		principalType: input.principalType,
		requestId: input.requestId,
		safetyIdentifier: input.safetyIdentifier ?? null,
		startedAt: new Date(input.startedAt),
		status: input.status,
		surface: input.surface,
		updatedAt: new Date(input.updatedAt),
	};
}

export function buildRequestObservabilityFactInsertValues(input: RequestObservabilityFactWrite) {
	return buildRequestObservabilityFactRecord(input);
}

export function buildRequestObservabilityFactUpdateValues(input: RequestObservabilityFactWrite) {
	const { requestId, ...rest } = buildRequestObservabilityFactRecord(input);
	return rest;
}

export function buildConversationTitleUpdateValues(input: { title: string; updatedAt: string }) {
	return {
		title: input.title,
		updatedAt: new Date(input.updatedAt),
	};
}

export function buildSessionSlotInsertValues(input: {
	conversationId: string;
	sessionSlots: FinalizeRequestWrite["sessionSlots"];
}): (typeof sessionSlots.$inferInsert)[] {
	return input.sessionSlots.map((slot) => ({
		conversationId: input.conversationId,
		name: slot.name,
		value: slot.value,
		confirmed: slot.confirmed,
		updatedAt: new Date(slot.updatedAt),
	}));
}
