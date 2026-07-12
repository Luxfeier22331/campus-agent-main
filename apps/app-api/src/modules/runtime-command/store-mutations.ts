import type { conversations, messages, sessionSlots } from "../../db/schema";
import type {
	AcceptRequestWrite,
	FinalizeRequestWrite,
	ProjectionOutboxWrite,
	RequestExecutionWrite,
	RequestObservabilityFactWrite,
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
		runId: input.runId ?? null,
		isActiveBranchHead: input.isActiveBranchHead ?? false,
	};
}

export function buildAcceptRequestExecutionInsertValues(input: RequestExecutionWrite) {
	return {
		requestId: input.requestId,
		conversationId: input.conversationId,
		userMessageId: input.userMessageId,
		assistantMessageId: null,
		turnSequence: input.turnSequence,
		surface: input.surface,
		actorUserId: input.actorUserId,
		actorPrincipalId: input.actorPrincipalId,
		actorRolesJson: input.actorRoles,
		actorDepartmentsJson: input.actorDepartments,
		principalType: input.principalType,
		principalLabel: input.principalLabel,
		entitlementSnapshotId: input.entitlementSnapshotId,
		entitlementGroupsJson: input.entitlementGroups,
		visibilityScope: input.visibilityScope,
		applicabilityScope: input.applicabilityScope,
		idempotencyKey: input.idempotencyKey,
		requestFingerprintSha256: input.requestFingerprintSha256,
		traceId: input.traceId,
		runId: input.runId,
		safetyIdentifier: input.safetyIdentifier ?? null,
		requestedTool: input.requestedTool,
		requestedScope: input.requestedScope,
		versionQueryJson: input.versionQuery,
		resolvedScope: input.resolvedScope,
		selectedTool: null,
		status: input.status,
		errorCode: null,
		questionPreview: input.questionPreview,
		answerPreview: null,
		sourceDocIdsJson: [],
		startedAt: new Date(input.startedAt),
		completedAt: null,
		durationMs: null,
		createdAt: new Date(input.createdAt),
		updatedAt: new Date(input.updatedAt),
	};
}

export function buildFinalizeRequestExecutionUpdateValues(input: RequestExecutionWrite) {
	return {
		assistantMessageId: input.assistantMessageId,
		turnSequence: input.turnSequence,
		selectedTool: input.selectedTool,
		status: input.status,
		errorCode: input.errorCode,
		requestedScope: input.requestedScope,
		versionQueryJson: input.versionQuery,
		resolvedScope: input.resolvedScope,
		runId: input.runId,
		safetyIdentifier: input.safetyIdentifier ?? null,
		answerPreview: input.answerPreview,
		sourceDocIdsJson: input.sourceDocIds,
		completedAt: input.completedAt ? new Date(input.completedAt) : null,
		durationMs: input.durationMs,
		updatedAt: new Date(input.updatedAt),
	};
}

export function buildProjectionOutboxInsertValues(input: ProjectionOutboxWrite) {
	return {
		eventId: input.eventId,
		requestId: input.requestId,
		eventType: input.eventType,
		payloadJson: input.payload as Record<string, unknown>,
		occurredAt: new Date(input.occurredAt),
		availableAt: new Date(input.availableAt),
		processedAt: null,
		attemptCount: input.attemptCount,
		lastError: null,
	};
}

function buildRequestObservabilityFactRecord(input: RequestObservabilityFactWrite) {
	return {
		aclAnomalyCode: input.aclAnomalyCode,
		aclDecision: input.aclDecision,
		supportingSourcesJson: input.supportingSources,
		completedAt: input.completedAt ? new Date(input.completedAt) : null,
		conversationId: input.conversationId,
		durationMs: input.durationMs,
		entitlementSnapshotId: input.entitlementSnapshotId,
		errorCode: input.errorCode,
		failClosed: input.failClosed,
		workflowTraceSummaryJson: input.workflowTraceSummary ?? null,
		stageTimingJson: input.stageTiming ?? {},
		answerEvalFingerprintJson: input.answerEvalFingerprint ?? null,
		llmIoFingerprintJson: input.llmIoFingerprint ?? null,
		measuredAt: new Date(input.measuredAt),
		modelName: input.modelName,
		modelProvider: input.modelProvider,
		promptId: input.promptId,
		promptVersion: input.promptVersion,
		templateSha256: input.templateSha256,
		policyProjectionVersion: input.policyProjectionVersion,
		policyReason: input.policyReason,
		principalType: input.principalType,
		projectionLagMs: input.projectionLagMs,
		requestId: input.requestId,
		safetyIdentifier: input.safetyIdentifier ?? null,
		requestedTool: input.requestedTool,
		requestedScopeSummary: input.requestedScopeSummary,
		versionQueryMode: input.versionQueryMode,
		versionQuerySummary: input.versionQuerySummary,
		resolvedScopeSummary: input.resolvedScopeSummary,
		refusalClass: input.refusalClass,
		scopeClass: input.scopeClass,
		semanticOutcome: input.semanticOutcome,
		selectedTool: input.selectedTool,
		startedAt: new Date(input.startedAt),
		status: input.status,
		surface: input.surface,
		traceAvailable: input.traceAvailable,
		traceId: input.traceId,
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
