import { vi } from "vitest";

import type {
	AppPrincipalType,
	AuthorizationProjectionSource,
	ResolvedAppPrincipal,
} from "../src/modules/auth";
import type { ChatConversation, ChatMessage } from "../src/modules/chat";
import type {
	CapabilityExecutionInput,
	CapabilityExecutionResponse,
	ExecutionControlRun,
	ExecutionControlRunCreateInput,
	ExecutionControlRunEvent,
	ExecutionControlRuntimeClient,
} from "../src/modules/integration/execution-control";
import { parseExecutionFinalizationResponsePayload } from "../src/modules/integration/execution-control";
import type {
	ChatCommandStore,
	ChatConversationStore,
	FinalizeRequestWrite,
} from "../src/modules/runtime-command";
import type { AppTelemetry } from "../src/modules/telemetry";

export { createHmac } from "node:crypto";
export type { ResolvedAppPrincipal } from "../src/modules/auth";
export interface CapabilityExecutionClient {
	execute(input: CapabilityExecutionInput): Promise<CapabilityExecutionResponse>;
	executeStream?(input: CapabilityExecutionInput): Promise<Response>;
}
export type {
	ChatCommandStore,
	ChatConversationStore,
	FinalizeRequestWrite,
} from "../src/modules/runtime-command";
export {
	buildChatCommandService,
	DRAFT_CONVERSATION_TITLE,
	deriveSafetyIdentifier,
	ExecutionControlTransportError,
} from "../src/modules/runtime-command";
export type { AppTelemetry } from "../src/modules/telemetry";

export const CURRICULUM_PROGRAM_FAMILY_SLOT_NAME = "curriculum_program_family";
export const CURRICULUM_PROGRAM_SLOT_NAME = "curriculum_program";
export const CURRICULUM_SEMESTER_SLOT_NAME = "curriculum_semester";

function createAuthorization() {
	return {
		applicabilityScope: "undergraduate",
		approvalState: "not_required",
		entitlementGroups: ["students"],
		entitlementSnapshotId: "entitlements-2026-03-29",
		ownershipScopes: ["conversation:user_01HQ"],
		principalId: "user_01HQ",
		projectionSource: "campus_identity" as const,
		retrievalFilter: {
			entitlementGroups: ["students"],
			policyProjectionVersion: "phase1-authorization-projection-v1",
			visibilityLevel: "public",
			visibilityScope: "main",
		},
		visibilityScope: "main",
	};
}

export function createPrincipal(): ResolvedAppPrincipal {
	return {
		principal: {
			type: "student",
			principalId: "user_01HQ",
			displayName: "Jane Doe",
			email: "jane@example.edu",
		},
		session: {
			sessionId: "sess_01HQ",
			expiresAt: "2026-03-29T07:00:00.000Z",
		},
		permissions: {
			chat: true,
			operator: false,
		},
		authorization: createAuthorization(),
		actor: {
			userId: "user_01HQ",
			principalId: "user_01HQ",
			principalType: "student",
			roles: ["student"],
			departments: [],
		},
	};
}

export function createConversation(): ChatConversation {
	return {
		id: "conv_01HQ",
		ownerUserId: "user_01HQ",
		title: "图书馆开放时间",
		createdAt: "2026-03-28T07:59:00.000Z",
		updatedAt: "2026-03-28T07:59:00.000Z",
		activeBranchId: "branch_active",
		activeMessageId: null,
		activeRunId: null,
		activeTurnSequence: 0,
		contextSummary: null,
		sessionSlots: [] as Array<{
			confirmed: boolean;
			name: string;
			updatedAt: string;
			value: string;
		}>,
		messages: [] as ChatMessage[],
	};
}

export function createDeterministicIdGenerator() {
	const counters = new Map<string, number>();

	return (prefix: string) => {
		const nextValue = (counters.get(prefix) ?? 0) + 1;
		counters.set(prefix, nextValue);
		return `${prefix}_${String(nextValue).padStart(4, "0")}`;
	};
}

export function createConversationStore(input?: {
	conversation?: ReturnType<typeof createConversation>;
}) {
	const conversation = input?.conversation ?? createConversation();
	const store: ChatConversationStore = {
		createConversationDraft: vi.fn(),
		deleteConversationByOwner: vi.fn(),
		deleteConversationsByOwner: vi.fn(),
		deleteMessageFeedbackByOwner: vi.fn(),
		deleteTrailingMessagesFromMessageByOwner: vi.fn(),
		getConversationByOwner: vi.fn(async (ownerUserId: string, conversationId: string) => {
			if (ownerUserId !== conversation.ownerUserId || conversationId !== conversation.id) {
				return null;
			}

			return structuredClone(conversation);
		}),
		getConversationDetailByOwner: vi.fn(),
		listConversationSummariesPageByOwner: vi.fn(),
		listConversationSummariesByOwner: vi.fn(),
		markConversationArchivedByOwner: vi.fn(),
		markConversationDeletedByOwner: vi.fn(),
		markConversationPinnedByOwner: vi.fn(),
		renameConversationByOwner: vi.fn(),
		searchConversationSummariesByOwner: vi.fn(),
		upsertMessageFeedbackByOwner: vi.fn(),
	};

	return {
		conversation,
		store,
	};
}

export function createCommandStore(input?: {
	conversation?: ReturnType<typeof createConversation>;
}) {
	const conversation = input?.conversation ?? createConversation();
	const acceptedWrites: unknown[] = [];
	const finalWrites: unknown[] = [];
	const store: ChatCommandStore = {
		acceptRequest: vi.fn(async (input) => {
			acceptedWrites.push(input);
			if (input.conversationSeed) {
				conversation.id = input.conversationSeed.id;
				conversation.ownerUserId = input.conversationSeed.ownerUserId;
				conversation.createdAt = input.conversationSeed.createdAt;
			}
			conversation.title = input.conversationTitle;
			conversation.updatedAt = input.userMessage.createdAt;
			conversation.activeBranchId = input.userMessage.branchId ?? "branch_active";
			conversation.activeMessageId = input.userMessage.id;
			conversation.activeRunId = input.userMessage.runId ?? null;
			conversation.activeTurnSequence = input.requestExecution.turnSequence;
			for (const message of conversation.messages) {
				if (message.branchId === conversation.activeBranchId) {
					message.isActiveBranchHead = false;
				}
			}
			conversation.messages.push({
				...input.userMessage,
				kind: null,
				requestId: null,
				retryable: null,
				structuredParts: [],
			});
		}),
		finalizeRequest: vi.fn(async (input: FinalizeRequestWrite) => {
			finalWrites.push(input);
			const isActiveRun =
				conversation.activeRunId === input.requestExecution.runId &&
				conversation.activeTurnSequence === input.requestExecution.turnSequence;
			if (isActiveRun) {
				conversation.title = input.conversationTitle;
				conversation.updatedAt = input.assistantMessage.createdAt;
				conversation.activeBranchId = input.assistantMessage.branchId ?? "branch_active";
				conversation.activeMessageId = input.assistantMessage.id;
				conversation.activeRunId = input.assistantMessage.runId ?? null;
				conversation.activeTurnSequence = input.requestExecution.turnSequence;
				conversation.contextSummary = input.contextSummary;
				for (const message of conversation.messages) {
					if (message.branchId === conversation.activeBranchId) {
						message.isActiveBranchHead = false;
					}
				}
			}
			if (isActiveRun && input.sessionSlots) {
				const nextSlots = input.sessionSlots.map(
					(slot: FinalizeRequestWrite["sessionSlots"][number]) => ({
						...slot,
					}),
				);
				conversation.sessionSlots = nextSlots;
			}
			conversation.messages.push({
				...input.assistantMessage,
				isActiveBranchHead: isActiveRun,
			});
			return structuredClone(conversation);
		}),
		findIdempotentRequest: vi.fn(async () => null),
		getAbuseControlState: vi.fn(async () => ({
			activeThrottleUntil: null,
			requestCountLastMinute: 0,
			requestCountLastTenMinutes: 0,
			shouldThrottle: false,
			throttleReason: null,
		})),
		listAcceptedDurableRequestsForCloseout: vi.fn(async () => []),
		listPreviousCapabilityResultRefs: vi.fn(async () => []),
	};

	return {
		acceptedWrites,
		conversation,
		finalWrites,
		store,
	};
}

export function createTelemetryMock(): AppTelemetry {
	return {
		captureException: vi.fn(),
		configureChatRequestScope: vi.fn(),
		configureHttpRequestScope: vi.fn(),
		getTraceHeaders: vi.fn().mockReturnValue({
			baggage: "sentry-environment=test",
			sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
		}),
		markHttpResponseStatus: vi.fn(),
		recordExecutionAuditEvent: vi.fn(),
		recordIdentityEndpoint: vi.fn(),
		recordProjectionDrain: vi.fn(),
		recordProjectionEnqueued: vi.fn(),
		recordQualitySampledGrade: vi.fn(),
		recordRequestAccepted: vi.fn(),
		recordRequestFinalized: vi.fn(),
		recordRequestTransportError: vi.fn(),
	};
}

export function expectNoInternalLocators(text: string) {
	for (const marker of ["source-faithful", "program_semester_facts:", "chunk-"]) {
		if (text.includes(marker)) {
			throw new Error(`Unexpected internal locator marker in answer: ${marker}`);
		}
	}
	if (/\[[^\]]*#[^\]]*\]/.test(text)) {
		throw new Error("Unexpected internal source locator markdown in answer.");
	}
}

export function createExecutionRuntimeFromCapabilityClient(
	client: CapabilityExecutionClient,
): ExecutionControlRuntimeClient {
	const eventsByRun = new Map<string, ExecutionControlRunEvent[]>();
	const runsById = new Map<string, ExecutionControlRun>();

	async function createRun(input: ExecutionControlRunCreateInput): Promise<ExecutionControlRun> {
		const executionInput = capabilityExecutionInputFromRunCreate(input);
		const run = durableRunFromCreateInput(input);
		runsById.set(input.runId, run);
		if (client.executeStream) {
			const response = await client.executeStream(executionInput);
			eventsByRun.set(input.runId, await durableEventsFromExecutionSse(input, response));
			return run;
		}
		const response = await client.execute(executionInput);
		eventsByRun.set(input.runId, [finalizationEventFromResponse(input, response, 1)]);
		return run;
	}

	return {
		cancelRun: vi.fn(async (input) => {
			const existing = runsById.get(input.runId);
			if (!existing) {
				throw new Error(`Unknown durable run: ${input.runId}`);
			}
			const cancelled = {
				...existing,
				completedAt: existing.updatedAt,
				status: "cancelled",
				terminalReason: input.reason,
			};
			runsById.set(input.runId, cancelled);
			return cancelled;
		}),
		createRun: vi.fn(createRun),
		getRun: vi.fn(async (input) => {
			const existing = runsById.get(input.runId);
			if (!existing) {
				throw new Error(`Unknown durable run: ${input.runId}`);
			}
			return existing;
		}),
		listRunEvents: vi.fn(async (input) =>
			(eventsByRun.get(input.runId) ?? []).filter(
				(event) => event.sequence > (input.afterSequence ?? 0),
			),
		),
		listRunSteps: vi.fn(async () => ({
			attempts: [],
			results: [],
			steps: [],
		})),
	};
}

function capabilityExecutionInputFromRunCreate(
	input: ExecutionControlRunCreateInput,
): CapabilityExecutionInput {
	const metadata = getRecordOrThrow(input.metadata, "run metadata");
	const payload = getRecordOrThrow(metadata.execution_payload, "execution payload");
	const context = internalContextFromWire(
		getRecordOrThrow(payload.context, "execution payload context"),
	);
	return {
		context: context as CapabilityExecutionInput["context"],
		conversationId: getString(payload.conversation_id) ?? input.conversationId,
		requestId: getString(payload.request_id) ?? input.requestId,
		requestedCapability: getString(payload.requested_capability),
		requestedScope: getRecord(
			payload.requested_scope,
		) as CapabilityExecutionInput["requestedScope"],
		safetyIdentifier: getString(payload.safety_identifier),
		surface: input.surface,
		tenantId: getString(payload.tenant_id),
		traceHeaders: input.traceHeaders,
		traceId: getTraceId(payload) ?? input.traceId ?? "",
		userGoal: getString(payload.user_goal) ?? "",
		versionQuery: getRecord(payload.version_query) as CapabilityExecutionInput["versionQuery"],
	};
}

function internalContextFromWire(
	wire: Record<string, unknown>,
): CapabilityExecutionInput["context"] {
	const actor = internalActorFromWire(getRecordOrThrow(wire.actor, "execution context actor"));
	const authorizationWire = getRecordOrThrow(wire.authorization, "execution context authorization");
	const retrievalFilterWire = getRecordOrThrow(
		authorizationWire.retrieval_filter,
		"execution context retrieval filter",
	);
	const memoryWire = getRecord(wire.memory);
	const sessionWire = getRecordOrThrow(wire.session, "execution context session");
	const selectedNoticeWire = getRecord(sessionWire.selected_notice_ref);
	return {
		actor,
		authorization: {
			applicabilityScope: getString(authorizationWire.applicability_scope) ?? "",
			approvalState: getString(authorizationWire.approval_state) ?? "",
			entitlementGroups: getStringArray(authorizationWire.entitlement_groups),
			entitlementSnapshotId: getString(authorizationWire.entitlement_snapshot_id) ?? "",
			ownershipScopes: getStringArray(authorizationWire.ownership_scopes),
			principalId: getString(authorizationWire.principal_id) ?? "",
			projectionSource: authorizationProjectionSource(authorizationWire.projection_source),
			retrievalFilter: {
				entitlementGroups: getStringArray(retrievalFilterWire.entitlement_groups),
				policyProjectionVersion: getString(retrievalFilterWire.policy_projection_version) ?? "",
				visibilityLevel: getString(retrievalFilterWire.visibility_level) ?? "",
				visibilityScope: getString(retrievalFilterWire.visibility_scope) ?? "",
			},
			visibilityScope: getString(authorizationWire.visibility_scope) ?? "",
		},
		...(typeof memoryWire?.enabled === "boolean"
			? { memory: { enabled: memoryWire.enabled } }
			: {}),
		session: {
			confirmedSlots: getRecordArray(sessionWire.confirmed_slots).map((slot) => ({
				confirmed: slot.confirmed === true,
				name: getString(slot.name) ?? "",
				value: getString(slot.value) ?? "",
			})),
			...(selectedNoticeWire
				? {
						selectedNoticeRef: {
							noticeId: getString(selectedNoticeWire.notice_id) ?? "",
							sourceFamily: getString(selectedNoticeWire.source_family) ?? "",
							targetSurface: getString(selectedNoticeWire.target_surface) ?? "",
							title: getString(selectedNoticeWire.title) ?? "",
						},
					}
				: {}),
			turnCount: typeof sessionWire.turn_count === "number" ? sessionWire.turn_count : 0,
		},
	};
}

function internalActorFromWire(
	wire: Record<string, unknown>,
): CapabilityExecutionInput["context"]["actor"] {
	return {
		cohort: getString(wire.cohort) ?? undefined,
		departments: getStringArray(wire.departments),
		major: getString(wire.major) ?? undefined,
		principalId: getString(wire.principal_id) ?? "",
		principalType: appPrincipalType(wire.principal_type),
		program: getString(wire.program) ?? undefined,
		roles: getStringArray(wire.roles),
		userId: getString(wire.user_id) ?? "",
	};
}

function durableRunFromCreateInput(input: ExecutionControlRunCreateInput): ExecutionControlRun {
	const now = "2026-06-04T01:02:03.000Z";
	return {
		admittedAt: "",
		completedAt: "",
		conversationId: input.conversationId,
		createdAt: now,
		failCloseReason: "",
		finalResponseRef: "",
		lane: input.lane,
		ownerUserId: input.ownerUserId,
		requestId: input.requestId,
		requestedCapability: input.requestedCapability ?? "",
		runId: input.runId,
		selectedCapability: input.selectedCapability ?? "",
		startedAt: "",
		status: "queued",
		streamingStartedAt: "",
		surface: input.surface,
		terminalReason: "",
		traceId: input.traceId ?? "",
		turnId: input.turnId,
		updatedAt: now,
		workflowPlanRef: "",
	};
}

async function durableEventsFromExecutionSse(
	input: ExecutionControlRunCreateInput,
	response: Response,
): Promise<ExecutionControlRunEvent[]> {
	const text = await response.text();
	const blocks = text
		.split(/\r?\n\r?\n/)
		.map((block) => block.trim())
		.filter(Boolean);
	const events: ExecutionControlRunEvent[] = [];
	for (const block of blocks) {
		const parsed = parseSseBlock(block);
		if (!parsed) {
			continue;
		}
		const sequence = events.length + 1;
		const event = durableEventFromExecutionLifecycle(input, parsed, sequence);
		if (event) {
			events.push(event);
		}
	}
	return events;
}

function parseSseBlock(block: string): { data: Record<string, unknown>; event: string } | null {
	let event = "message";
	const dataLines: string[] = [];
	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith("event:")) {
			event = line.slice("event:".length).trim();
			continue;
		}
		if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart());
		}
	}
	if (dataLines.length === 0) {
		return null;
	}
	return {
		data: JSON.parse(dataLines.join("\n")) as Record<string, unknown>,
		event,
	};
}

function durableEventFromExecutionLifecycle(
	input: ExecutionControlRunCreateInput,
	parsed: { data: Record<string, unknown>; event: string },
	sequence: number,
): ExecutionControlRunEvent | null {
	if (parsed.event === "execution.queued") {
		return baseRunEvent(input, {
			eventType: "run.queued",
			occurredAt: getString(parsed.data.occurred_at) ?? "",
			payload: { status: getString(parsed.data.status) ?? "queued" },
			sequence,
		});
	}
	if (parsed.event === "execution.running") {
		return baseRunEvent(input, {
			eventType: "run.started",
			occurredAt: getString(parsed.data.occurred_at) ?? "",
			payload: { status: getString(parsed.data.status) ?? "running" },
			sequence,
		});
	}
	if (parsed.event === "execution.completed") {
		const response = getRecord(parsed.data.response);
		if (!response) {
			return baseRunEvent(input, {
				eventType: "finalization.completed",
				occurredAt: getString(parsed.data.occurred_at) ?? "",
				payload: {
					request_id: getString(parsed.data.request_id) ?? input.requestId,
					response: responseWireFromCapabilityResponse(
						executionErrorResponse({
							code: "execution_control_invalid_response",
							message: "Execution stream completed without a response payload.",
							retryable: true,
							traceId: getString(parsed.data.trace_id) ?? input.traceId ?? "",
						}),
					),
					trace_id: getString(parsed.data.trace_id) ?? input.traceId ?? "",
				},
				sequence,
			});
		}
		parseExecutionFinalizationResponsePayload(response);
		return baseRunEvent(input, {
			eventType: "finalization.completed",
			occurredAt: getString(parsed.data.occurred_at) ?? "",
			payload: {
				request_id: getString(parsed.data.request_id) ?? input.requestId,
				response,
				trace_id: getString(parsed.data.trace_id) ?? input.traceId ?? "",
			},
			sequence,
		});
	}
	if (parsed.event === "execution.failed" || parsed.event === "execution.cancelled") {
		const error = getRecord(parsed.data.error);
		const response = error
			? executionErrorResponse({
					code: getString(error.code) ?? "execution_control_invalid_response",
					message: getString(error.message) ?? "Execution terminal error payload is invalid.",
					retryable: typeof error.retryable === "boolean" ? error.retryable : true,
					traceId: getString(parsed.data.trace_id) ?? input.traceId ?? "",
				})
			: executionErrorResponse({
					code: "execution_control_invalid_response",
					message: "Execution terminal error payload is invalid.",
					retryable: true,
					traceId: getString(parsed.data.trace_id) ?? input.traceId ?? "",
				});
		return baseRunEvent(input, {
			eventType: "finalization.completed",
			occurredAt: getString(parsed.data.occurred_at) ?? "",
			payload: {
				request_id: getString(parsed.data.request_id) ?? input.requestId,
				response: responseWireFromCapabilityResponse(response),
				trace_id: getString(parsed.data.trace_id) ?? input.traceId ?? "",
			},
			sequence,
		});
	}
	return null;
}

function finalizationEventFromResponse(
	input: ExecutionControlRunCreateInput,
	response: CapabilityExecutionResponse,
	sequence: number,
): ExecutionControlRunEvent {
	return baseRunEvent(input, {
		eventType: "finalization.completed",
		payload: {
			request_id: input.requestId,
			response: responseWireFromCapabilityResponse(response),
			trace_id: input.traceId ?? "",
		},
		sequence,
	});
}

function baseRunEvent(
	input: ExecutionControlRunCreateInput,
	overrides: {
		eventType: string;
		occurredAt?: string;
		payload: Record<string, unknown>;
		sequence: number;
	},
): ExecutionControlRunEvent {
	return {
		conversationId: input.conversationId,
		eventId: `${input.runId}:event:${overrides.sequence}`,
		eventType: overrides.eventType,
		occurredAt: overrides.occurredAt || "2026-06-04T01:02:04.000Z",
		payload: overrides.payload,
		payloadSchemaVersion: "run-event-v1",
		runId: input.runId,
		sequence: overrides.sequence,
		visibility: "browser",
	};
}

function responseWireFromCapabilityResponse(
	response: CapabilityExecutionResponse,
): Record<string, unknown> {
	return {
		answer_text: response.answerText,
		confidence: "high",
		error: response.error
			? {
					code: response.error.code,
					message: response.error.message,
					retryable: response.error.retryable,
				}
			: null,
		follow_up_question: response.followUpQuestion,
		...(response.observability
			? { observability: observabilityWireFromCapabilityResponse(response.observability) }
			: {}),
		result: response.result ?? null,
		selected_capability: response.selectedCapability,
		status: response.status,
		trace_id: response.traceId,
		...(response.workflowTraceSummary
			? { workflow_trace_summary: response.workflowTraceSummary }
			: {}),
	};
}

function observabilityWireFromCapabilityResponse(
	observability: NonNullable<CapabilityExecutionResponse["observability"]>,
): Record<string, unknown> {
	return {
		acl_anomaly_code: observability.aclAnomalyCode,
		acl_decision: observability.aclDecision,
		cached_input_tokens: observability.cachedInputTokens,
		candidate_count: observability.candidateCount,
		citation_count: observability.citationCount,
		citation_expected: observability.citationExpected,
		citation_missing: observability.citationMissing,
		estimated_cost_microusd: observability.estimatedCostMicrousd,
		fail_closed: observability.failClosed,
		input_tokens: observability.inputTokens,
		intent_ambiguity_reason: observability.intentAmbiguityReason,
		intent_ambiguity_signal: observability.intentAmbiguitySignal,
		intent_capability: observability.intentCapability,
		intent_classifier_version: observability.intentClassifierVersion,
		intent_context_reference_type: observability.intentContextReferenceType,
		intent_context_resolution_state: observability.intentContextResolutionState,
		intent_launch_state: observability.intentLaunchState,
		intent_missing_slots: observability.intentMissingSlots,
		intent_next_action: observability.intentNextAction,
		intent_policy_reason: observability.intentPolicyReason,
		intent_resolved_slots: observability.intentResolvedSlots,
		intent_routing_confidence: observability.intentRoutingConfidence,
		intent_schema_version: observability.intentSchemaVersion,
		intent_scope_class: observability.intentScopeClass,
		intent_scope_reason: observability.intentScopeReason,
		intent_task_kind: observability.intentTaskKind,
		model_name: observability.modelName,
		model_provider: observability.modelProvider,
		output_tokens: observability.outputTokens,
		policy_reason: observability.policyReason,
		model_execution_detail: observability.modelExecutionDetail,
		model_execution_state: observability.modelExecutionState,
		prompt_trace: observability.promptTrace
			? {
					model_name: observability.promptTrace.modelName,
					model_provider: observability.promptTrace.modelProvider,
					output_schema_version: observability.promptTrace.outputSchemaVersion,
					prompt_id: observability.promptTrace.promptId,
					prompt_version: observability.promptTrace.promptVersion,
					template_sha256: observability.promptTrace.templateSha256,
					variables_schema_version: observability.promptTrace.variablesSchemaVersion,
				}
			: null,
		refusal_class: observability.refusalClass,
		retrieval_attempted: observability.retrievalAttempted,
		retrieved_source_count: observability.retrievedSourceCount,
		retrieved_sources: observability.retrievedSources,
		resolved_scope_collection: observability.resolvedScopeCollection,
		resolved_scope_corpus: observability.resolvedScopeCorpus,
		scope_class: observability.scopeClass,
		semantic_outcome: observability.semanticOutcome,
		selected_tool: observability.selectedTool,
		tool_business_outcome: observability.toolBusinessOutcome,
		tool_fail_close_reason: observability.toolFailCloseReason,
		tool_historical_downgrade_reason: observability.toolHistoricalDowngradeReason,
	};
}

function executionErrorResponse(input: {
	code: string;
	message: string;
	retryable: boolean;
	traceId: string;
}): CapabilityExecutionResponse {
	return {
		answerText: "",
		error: {
			code: input.code,
			message: input.message,
			retryable: input.retryable,
		},
		followUpQuestion: "",
		result: null,
		selectedCapability: null,
		status: "error",
		traceId: input.traceId,
	};
}

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function getRecordOrThrow(value: unknown, label: string): Record<string, unknown> {
	const record = getRecord(value);
	if (!record) {
		throw new Error(`${label} must be an object`);
	}
	return record;
}

function getString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function getStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function getRecordArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value)
		? value.flatMap((item): Record<string, unknown>[] => {
				const record = getRecord(item);
				return record ? [record] : [];
			})
		: [];
}

function getTraceId(payload: Record<string, unknown>): string | null {
	const trace = getRecord(payload.trace);
	return trace ? getString(trace.trace_id) : null;
}

function authorizationProjectionSource(value: unknown): AuthorizationProjectionSource {
	const normalized = getString(value);
	if (
		normalized === "campus_identity" ||
		normalized === "operator_headers" ||
		normalized === "service_auth"
	) {
		return normalized;
	}
	return "campus_identity";
}

function appPrincipalType(value: unknown): AppPrincipalType {
	const normalized = getString(value);
	if (
		normalized === "student" ||
		normalized === "staff" ||
		normalized === "faculty" ||
		normalized === "campus_member" ||
		normalized === "operator" ||
		normalized === "service"
	) {
		return normalized;
	}
	return "student";
}
