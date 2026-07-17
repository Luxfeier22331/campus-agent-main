import { vi } from "vitest";

import type {
	AppPrincipalType,
	AuthorizationProjectionSource,
	ResolvedAppPrincipal,
} from "../src/modules/auth";
import type { ChatConversation, ChatMessage } from "../src/modules/chat";
import type {
	ExecutionControlRun,
	ExecutionControlRunCreateInput,
	ExecutionControlRunEvent,
	ExecutionControlRuntimeClient,
	ToolExecutionInput,
	ToolExecutionResponse,
} from "../src/modules/integration/execution-control";
import { parseExecutionFinalizationResponsePayload } from "../src/modules/integration/execution-control";
import type {
	AcceptRequestWrite,
	ChatCommandService,
	ChatCommandServiceDependencies,
	ChatCommandStore,
	ChatConversationStore,
	FinalizeRequestWrite,
} from "../src/modules/runtime-command";
import { buildChatCommandService as buildProductionChatCommandService } from "../src/modules/runtime-command";
import type { AppTelemetry } from "../src/modules/telemetry";

export { createHmac } from "node:crypto";
export type { ResolvedAppPrincipal } from "../src/modules/auth";
export interface ToolExecutionClient {
	execute(input: ToolExecutionInput): Promise<ToolExecutionResponse>;
	executeStream?(input: ToolExecutionInput): Promise<Response>;
}
export type {
	ChatCommandStore,
	ChatConversationStore,
	FinalizeRequestWrite,
} from "../src/modules/runtime-command";
export {
	DRAFT_CONVERSATION_TITLE,
	deriveSafetyIdentifier,
	ExecutionControlTransportError,
} from "../src/modules/runtime-command";
export type { AppTelemetry } from "../src/modules/telemetry";

export const PUBLIC_NOTICE_URL_ALLOWLIST = ["www.example.edu"];
export const CURRICULUM_PROGRAM_FAMILY_SLOT_NAME = "curriculum_program_family";
export const CURRICULUM_PROGRAM_SLOT_NAME = "curriculum_program";
export const CURRICULUM_SEMESTER_SLOT_NAME = "curriculum_semester";

const pendingProductCallbacks = new Map<
	string,
	(response: ToolExecutionResponse, completedAt: string) => Promise<void>
>();
const finalizedConversations = new Map<string, ChatConversation>();
const testServicesByStore = new WeakMap<ChatCommandStore, ChatCommandService>();
const runtimeHandlesProductCallback = Symbol("runtimeHandlesProductCallback");

export function buildChatCommandService(
	dependencies: ChatCommandServiceDependencies,
): ChatCommandService {
	const service = buildProductionChatCommandService(dependencies);
	testServicesByStore.set(dependencies.store, service);
	const runtime = dependencies.executionRuntime as
		| (ExecutionControlRuntimeClient & { [runtimeHandlesProductCallback]?: boolean })
		| undefined;
	if (runtime && !runtime[runtimeHandlesProductCallback]) {
		const listRunEvents = runtime.listRunEvents.bind(runtime);
		runtime.listRunEvents = vi.fn(async (input) => {
			const events = await listRunEvents(input);
			await applyTestProductCallback(input.runId, input.traceId, events);
			return events;
		});
	}
	return service;
}

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
			const finalized = finalizedConversations.get(conversationId);
			if (finalized?.ownerUserId === ownerUserId) {
				return structuredClone(finalized);
			}
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

export function createCommandStore(options?: {
	conversation?: ReturnType<typeof createConversation>;
	memorySnapshot?: {
		appendEnabled: boolean;
		ownerGeneration: number;
		ownerSequence: number;
		recallEnabled: boolean;
	} | null;
}) {
	const conversation = options?.conversation ?? createConversation();
	const acceptedWrites: AcceptRequestWrite[] = [];
	const finalWrites: FinalizeRequestWrite[] = [];
	finalizedConversations.delete(conversation.id);
	let store: ChatCommandStore;
	store = {
		listPendingAdmissions: vi.fn(async () => []),
		recordAdmissionInput: vi.fn(async (input) => {
			const runId = typeof input.workflowInput.runId === "string" ? input.workflowInput.runId : "";
			if (!runId) {
				return false;
			}
			pendingProductCallbacks.set(runId, async (response, completedAt) => {
				const service = testServicesByStore.get(store);
				if (!service?.applyProductFinalization) {
					throw new Error(`Missing product finalization callback for ${runId}.`);
				}
				await service.applyProductFinalization({
					completedAt,
					finalizationFingerprint: `test:${runId}`,
					response,
					runId,
				});
				finalizedConversations.set(conversation.id, structuredClone(conversation));
			});
			return true;
		}),
		markAdmitted: vi.fn(async () => true),
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
			conversation.activeTurnSequence = input.turnDispatch.turnSequence;
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
			return { memorySnapshot: options?.memorySnapshot ?? null };
		}),
		finalizeRequest: vi.fn(async (input: FinalizeRequestWrite) => {
			finalWrites.push(input);
			const isActiveRun =
				conversation.activeRunId === input.turnDispatch.runId &&
				conversation.activeTurnSequence === input.turnDispatch.turnSequence;
			if (isActiveRun) {
				conversation.title = input.conversationTitle;
				conversation.updatedAt = input.assistantMessage.createdAt;
				conversation.activeBranchId = input.assistantMessage.branchId ?? "branch_active";
				conversation.activeMessageId = input.assistantMessage.id;
				conversation.activeRunId = input.assistantMessage.runId ?? null;
				conversation.activeTurnSequence = input.turnDispatch.turnSequence;
				for (const message of conversation.messages) {
					if (message.branchId === conversation.activeBranchId) {
						message.isActiveBranchHead = false;
					}
				}
			}
			if (isActiveRun && input.sessionSlots.length > 0) {
				const updatedNames = new Set(input.sessionSlots.map((slot) => slot.name));
				conversation.sessionSlots = conversation.sessionSlots
					.filter((slot) => !updatedNames.has(slot.name))
					.concat(input.sessionSlots.map((slot) => ({ ...slot })));
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
		listAcceptedDurableRequestsForCloseout: vi.fn(async (input) => {
			const accepted = [...acceptedWrites]
				.reverse()
				.find(
					(write) =>
						write.turnDispatch.runId && (!input?.runId || write.turnDispatch.runId === input.runId),
				);
			if (!accepted?.turnDispatch.runId) {
				return [];
			}
			const snapshot = accepted.turnDispatch.principalSnapshot;
			const finalized = finalWrites.find(
				(write) => write.turnDispatch.runId === accepted.turnDispatch.runId,
			);
			return [
				{
					acceptedAt: accepted.turnDispatch.createdAt,
					assistantMessageId: accepted.turnDispatch.assistantMessageId,
					conversation: structuredClone(conversation),
					conversationTitle: accepted.conversationTitle,
					finalizationFingerprint: finalized?.finalizationFingerprint ?? null,
					idempotencyKey: accepted.turnDispatch.idempotencyKey,
					principal: {
						actor: snapshot.actor,
						authorization: snapshot.authorization ?? undefined,
						permissions: { chat: true },
						principal: { ...snapshot.principal, email: null },
						session: null,
					},
					questionPreview: accepted.userMessage.text,
					requestFingerprintSha256: accepted.turnDispatch.requestFingerprintSha256,
					requestId: accepted.turnDispatch.requestId,
					requestedTool: accepted.turnDispatch.requestedTool,
					runId: accepted.turnDispatch.runId,
					safetyIdentifier: accepted.turnDispatch.safetyIdentifier ?? null,
					surface: accepted.turnDispatch.surface,
					traceId: accepted.turnDispatch.traceId,
					turnSequence: accepted.turnDispatch.turnSequence,
					userMessageId: accepted.turnDispatch.userMessageId,
				},
			];
		}),
		listPreviousToolResultRefs: vi.fn(async () => []),
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

export function createExecutionRuntimeFromToolClient(
	client: ToolExecutionClient,
	options: {
		onProductFinalization?: (input: {
			completedAt: string;
			response: ToolExecutionResponse;
			runId: string;
			traceId: string;
		}) => Promise<void>;
		skipProductCallback?: boolean;
	} = {},
): ExecutionControlRuntimeClient {
	const eventsByRun = new Map<string, ExecutionControlRunEvent[]>();
	const runsById = new Map<string, ExecutionControlRun>();

	async function createRun(input: ExecutionControlRunCreateInput): Promise<ExecutionControlRun> {
		const executionInput = toolExecutionInputFromRunCreate(input);
		const run = durableRunFromCreateInput(input);
		runsById.set(input.runId, run);
		if (client.executeStream) {
			const response = await client.executeStream(executionInput);
			const events = await durableEventsFromExecutionSse(input, response);
			if (!options.skipProductCallback) {
				await applyTestProductCallback(
					input.runId,
					input.traceId ?? "",
					events,
					options.onProductFinalization,
				);
			}
			eventsByRun.set(input.runId, events);
			return run;
		}
		const response = await client.execute(executionInput);
		const events = [finalizationEventFromResponse(input, response, 1)];
		if (!options.skipProductCallback) {
			await applyTestProductCallback(
				input.runId,
				input.traceId ?? "",
				events,
				options.onProductFinalization,
			);
		}
		eventsByRun.set(input.runId, events);
		return run;
	}

	const runtime: ExecutionControlRuntimeClient & { [runtimeHandlesProductCallback]?: boolean } = {
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
	runtime[runtimeHandlesProductCallback] = true;
	return runtime;
}

async function applyTestProductCallback(
	runId: string,
	traceId: string,
	events: ExecutionControlRunEvent[],
	directCallback?: (input: {
		completedAt: string;
		response: ToolExecutionResponse;
		runId: string;
		traceId: string;
	}) => Promise<void>,
): Promise<void> {
	const callback = pendingProductCallbacks.get(runId);
	if (!(callback || directCallback)) {
		return;
	}
	const terminal = [...events]
		.reverse()
		.find(
			(event) =>
				event.eventType === "finalization.completed" ||
				event.eventType === "run.failed" ||
				event.eventType === "run.canceled",
		);
	if (!terminal) {
		return;
	}
	let response: ToolExecutionResponse;
	if (terminal.eventType === "finalization.completed") {
		response = parseExecutionFinalizationResponsePayload(
			getRecordOrThrow(terminal.payload.response, "finalization response"),
		);
	} else if (terminal.eventType === "run.failed") {
		const error = getRecord(terminal.payload.error);
		response = executionErrorResponse({
			code: getString(error?.code) ?? "execution_failed",
			message: getString(error?.message) ?? "Execution failed.",
			retryable: typeof error?.retryable === "boolean" ? error.retryable : true,
			traceId,
		});
	} else {
		response = executionErrorResponse({
			code: "execution_cancelled",
			message: "The request was cancelled.",
			retryable: false,
			status: "cancelled",
			traceId,
		});
	}
	if (directCallback) {
		await directCallback({
			completedAt: terminal.occurredAt,
			response,
			runId,
			traceId,
		});
		return;
	}
	await callback?.(response, terminal.occurredAt);
}

function toolExecutionInputFromRunCreate(
	input: ExecutionControlRunCreateInput,
): ToolExecutionInput {
	const metadata = getRecordOrThrow(input.metadata, "run metadata");
	const payload = getRecordOrThrow(metadata.execution_payload, "execution payload");
	const context = internalContextFromWire(
		getRecordOrThrow(payload.context, "execution payload context"),
	);
	return {
		context: context as ToolExecutionInput["context"],
		conversationId: getString(payload.conversation_id) ?? input.conversationId,
		requestId: getString(payload.request_id) ?? input.requestId,
		requestedTool: getString(payload.requested_tool),
		safetyIdentifier: getString(payload.safety_identifier),
		surface: input.surface,
		tenantId: getString(payload.tenant_id),
		traceHeaders: input.traceHeaders,
		traceId: getTraceId(payload) ?? input.traceId ?? "",
		userGoal: getString(payload.user_goal) ?? "",
	};
}

function internalContextFromWire(wire: Record<string, unknown>): ToolExecutionInput["context"] {
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
		...(typeof memoryWire?.recall_enabled === "boolean" &&
		typeof memoryWire.append_enabled === "boolean" &&
		typeof memoryWire.owner_generation === "number" &&
		typeof memoryWire.owner_sequence === "number"
			? {
					memory: {
						appendEnabled: memoryWire.append_enabled,
						ownerGeneration: memoryWire.owner_generation,
						ownerSequence: memoryWire.owner_sequence,
						recallEnabled: memoryWire.recall_enabled,
					},
				}
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
): ToolExecutionInput["context"]["actor"] {
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
	const metadata = getRecordOrThrow(input.metadata, "run metadata");
	const payload = getRecordOrThrow(metadata.execution_payload, "execution payload");
	return {
		admittedAt: "",
		completedAt: "",
		conversationId: input.conversationId,
		createdAt: now,
		failCloseReason: "",
		finalResponseRef: "",
		ownerUserId: input.ownerUserId,
		queuedAt: now,
		requestId: input.requestId,
		requestedTool: getString(payload.requested_tool) ?? "",
		runId: input.runId,
		selectedTool: "",
		startedAt: "",
		status: "queued",
		streamingStartedAt: "",
		surface: input.surface,
		taskQueue: "campus-agent.workflow",
		terminalReason: "",
		traceId: input.traceId ?? "",
		turnId: input.turnId,
		updatedAt: now,
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
					response: responseWireFromToolResponse(
						executionErrorResponse({
							code: "execution_control_invalid_response",
							message: "Execution stream completed without a response payload.",
							retryable: true,
							traceId: input.traceId ?? "",
						}),
					),
					trace_id: input.traceId ?? "",
				},
				sequence,
				visibility: "internal",
			});
		}
		parseExecutionFinalizationResponsePayload(response);
		return baseRunEvent(input, {
			eventType: "finalization.completed",
			occurredAt: getString(parsed.data.occurred_at) ?? "",
			payload: {
				request_id: getString(parsed.data.request_id) ?? input.requestId,
				response,
				trace_id: input.traceId ?? "",
			},
			sequence,
			visibility: "internal",
		});
	}
	if (parsed.event === "execution.failed" || parsed.event === "execution.cancelled") {
		const error = getRecord(parsed.data.error);
		const code = getString(error?.code) ?? "execution_control_invalid_response";
		const message = getString(error?.message) ?? "Execution terminal error payload is invalid.";
		const retryable = typeof error?.retryable === "boolean" ? error.retryable : true;
		if (parsed.event === "execution.failed") {
			return baseRunEvent(input, {
				eventType: "run.failed",
				occurredAt: getString(parsed.data.occurred_at) ?? "",
				payload: {
					error: { code, message, retryable },
					request_id: getString(parsed.data.request_id) ?? input.requestId,
					trace_id: input.traceId ?? "",
				},
				sequence,
			});
		}
		const response = executionErrorResponse({
			code,
			message,
			retryable,
			traceId: input.traceId ?? "",
		});
		return baseRunEvent(input, {
			eventType: "finalization.completed",
			occurredAt: getString(parsed.data.occurred_at) ?? "",
			payload: {
				request_id: getString(parsed.data.request_id) ?? input.requestId,
				response: responseWireFromToolResponse(response),
				trace_id: input.traceId ?? "",
			},
			sequence,
			visibility: "internal",
		});
	}
	return null;
}

function finalizationEventFromResponse(
	input: ExecutionControlRunCreateInput,
	response: ToolExecutionResponse,
	sequence: number,
): ExecutionControlRunEvent {
	return baseRunEvent(input, {
		eventType: "finalization.completed",
		payload: {
			request_id: input.requestId,
			response: responseWireFromToolResponse(response),
			trace_id: input.traceId ?? "",
		},
		sequence,
		visibility: "internal",
	});
}

function baseRunEvent(
	input: ExecutionControlRunCreateInput,
	overrides: Pick<ExecutionControlRunEvent, "eventType" | "payload" | "sequence"> &
		Partial<Pick<ExecutionControlRunEvent, "occurredAt" | "visibility">>,
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
		visibility: overrides.visibility ?? "browser",
	};
}

function responseWireFromToolResponse(response: ToolExecutionResponse): Record<string, unknown> {
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
			? { observability: observabilityWireFromToolResponse(response.observability) }
			: {}),
		resolved_targets: response.resolvedTargets,
		result: response.result ?? null,
		selected_tool: response.selectedTool,
		session_update: response.sessionUpdate
			? {
					upsert_slots: response.sessionUpdate.upsertSlots.map((slot) => ({
						confirmed: slot.confirmed,
						name: slot.name,
						value: slot.value,
					})),
				}
			: null,
		status: response.status,
		trace_id: response.traceId,
		...(response.workflowTraceSummary
			? { workflow_trace_summary: response.workflowTraceSummary }
			: {}),
	};
}

function observabilityWireFromToolResponse(
	observability: NonNullable<ToolExecutionResponse["observability"]>,
): Record<string, unknown> {
	return toSnakeCaseWire(observability) as Record<string, unknown>;
}

function toSnakeCaseWire(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(toSnakeCaseWire);
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, item]) => [
			key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
			toSnakeCaseWire(item),
		]),
	);
}

function executionErrorResponse(input: {
	code: string;
	message: string;
	retryable: boolean;
	status?: "error" | "cancelled";
	traceId: string;
}): ToolExecutionResponse {
	return {
		answerText: "",
		error: {
			code: input.code,
			message: input.message,
			retryable: input.retryable,
		},
		followUpQuestion: "",
		resolvedTargets: [],
		result: null,
		selectedTool: null,
		sessionUpdate: null,
		status: input.status ?? "error",
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
	if (normalized === "campus_identity" || normalized === "service_auth") {
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
		normalized === "service"
	) {
		return normalized;
	}
	return "student";
}
