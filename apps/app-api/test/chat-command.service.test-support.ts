import { createHash } from "node:crypto";
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
	AcceptedChatCommandStore,
	AcceptRequestWrite,
	ChatCommandObservabilityStore,
	ChatCommandService,
	ChatCommandServiceDependencies,
	ChatConversationStore,
	FinalizeRequestWrite,
	FrozenDurableRunWrite,
} from "../src/modules/runtime-command";
import { buildChatCommandService as buildProductionChatCommandService } from "../src/modules/runtime-command";
import { ChatFinalizationConflict } from "../src/modules/runtime-command/store-types";

export { createHmac } from "node:crypto";
export type { ResolvedAppPrincipal } from "../src/modules/auth";
export type ChatCommandStore = AcceptedChatCommandStore & ChatCommandObservabilityStore;
export interface ToolExecutionClient {
	execute(input: ToolExecutionInput): Promise<ToolExecutionResponse>;
	executeStream?(input: ToolExecutionInput): Promise<Response>;
}
export type {
	ChatCommandStreamEvent,
	ChatConversationStore,
	FinalizeRequestWrite,
} from "../src/modules/runtime-command";
export {
	ChatAcceptanceConversationConflict,
	ChatAcceptanceIdempotencyConflict,
	DRAFT_CONVERSATION_TITLE,
	deriveSafetyIdentifier,
	ExecutionControlTransportError,
} from "../src/modules/runtime-command";

export const CURRICULUM_PROGRAM_FAMILY_SLOT_NAME = "curriculum_program_family";
export const CURRICULUM_PROGRAM_SLOT_NAME = "curriculum_program";
export const CURRICULUM_SEMESTER_SLOT_NAME = "curriculum_semester";

const pendingProductCallbacks = new Map<
	string,
	(response: ToolExecutionResponse, completedAt: string) => Promise<void>
>();
// Keep the test transport's copy keyed by request id so the fake execution worker
// exercises the same frozen-input boundary as production.
const frozenExecutionInputsByRequest = new Map<string, string>();
const finalizedConversations = new Map<string, ChatConversation>();
const testServicesByStore = new WeakMap<ChatCommandStore, ChatCommandService>();
const runtimeHandlesProductCallback = Symbol("runtimeHandlesProductCallback");
const TEST_SAFETY_IDENTIFIER_HMAC_SECRET = "test-safety-identifier-secret";

function rememberFrozenExecutionInput(input: {
	executionInputJson: string;
	requestId: string;
}): void {
	const requestId = input.requestId;
	if (requestId) {
		frozenExecutionInputsByRequest.set(requestId, input.executionInputJson);
	}
}

export function getFrozenExecutionPayload(requestId: string): Record<string, unknown> {
	const frozenJson = frozenExecutionInputsByRequest.get(requestId);
	if (!frozenJson) {
		throw new Error(`Missing frozen execution input for ${requestId}.`);
	}
	const parsed = JSON.parse(frozenJson) as unknown;
	return getRecordOrThrow(parsed, "frozen execution payload");
}

export function buildChatCommandService(
	dependencies: Omit<
		ChatCommandServiceDependencies,
		"abuseThrottleEnabled" | "commandStore" | "observabilityStore"
	> & { abuseThrottleEnabled?: boolean; store: ChatCommandStore },
): ChatCommandService {
	const { store, ...serviceDependencies } = dependencies;
	const productionService = buildProductionChatCommandService({
		...serviceDependencies,
		abuseThrottleEnabled: dependencies.abuseThrottleEnabled ?? true,
		commandStore: store,
		observabilityStore: store,
		safetyIdentifierHmacSecret:
			dependencies.safetyIdentifierHmacSecret ?? TEST_SAFETY_IDENTIFIER_HMAC_SECRET,
	});
	const testIdempotencyKey = (input: Parameters<ChatCommandService["submit"]>[0]) =>
		input.idempotencyKey ??
		`test:${input.requestKind ?? "public_chat"}:${JSON.stringify(input.payload)}`;
	const service: ChatCommandService = {
		...productionService,
		submit: (input) =>
			productionService.submit({ ...input, idempotencyKey: testIdempotencyKey(input) }),
	};
	const productionSubmitStream = productionService.submitStream;
	if (productionSubmitStream) {
		service.submitStream = (input) =>
			productionSubmitStream({
				...input,
				idempotencyKey: testIdempotencyKey(input),
			});
	}
	testServicesByStore.set(store, service);
	const runtime = dependencies.executionRuntime as
		| (ExecutionControlRuntimeClient & { [runtimeHandlesProductCallback]?: boolean })
		| undefined;
	if (runtime && !runtime[runtimeHandlesProductCallback]) {
		const listRunEvents = runtime.listRunEvents.bind(runtime);
		runtime.listRunEvents = vi.fn(async (input) => {
			const page = await listRunEvents(input);
			await applyTestProductCallback(input.requestId, page.events);
			return page;
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
		activeRequestId: null,
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
	const requestStageTiming = new Map<string, Record<string, unknown>>();
	const frozenRuns: FrozenDurableRunWrite[] = [];
	const frozenRequestIds = new Map<string, string>();
	const frozenMemorySnapshots: Parameters<AcceptRequestWrite["freezeDurableRun"]>[0][] = [];
	finalizedConversations.delete(conversation.id);
	let store: ChatCommandStore;
	store = {
		readDurableRunInput: vi.fn(async (requestId: string) => {
			const executionInputJson = frozenRequestIds.get(requestId);
			return executionInputJson
				? {
						conversationId: conversation.id,
						executionInputSha256: createHash("sha256")
							.update(executionInputJson, "utf8")
							.digest("hex"),
						executionInputJson,
						memoryRecallEnabled: options?.memorySnapshot?.recallEnabled ?? null,
						ownerUserId: conversation.ownerUserId,
						requestId,
						surface: "campus_web",
						status: "accepted" as const,
					}
				: null;
		}),
		acceptRequest: vi.fn(async (input) => {
			const memorySnapshot =
				input.requestKind === "public_chat" ? (options?.memorySnapshot ?? null) : null;
			frozenMemorySnapshots.push(memorySnapshot ? { ...memorySnapshot } : null);
			const frozenRun = input.freezeDurableRun(memorySnapshot);
			const requestId = input.turnDispatch.requestId ?? "";
			if (!requestId) {
				throw new Error("Frozen request is missing its identity.");
			}
			rememberFrozenExecutionInput({ ...frozenRun, requestId });
			pendingProductCallbacks.set(requestId, async (response, completedAt) => {
				const service = testServicesByStore.get(store);
				if (!service?.applyProductFinalization) {
					throw new Error(`Missing product finalization callback for ${requestId}.`);
				}
				await service.applyProductFinalization({
					completedAt,
					finalizationFingerprint: `test:${requestId}`,
					response,
					requestId,
				});
				finalizedConversations.set(conversation.id, structuredClone(conversation));
			});
			frozenRuns.push(frozenRun);
			frozenRequestIds.set(requestId, frozenRun.executionInputJson);
			acceptedWrites.push(input);
			requestStageTiming.set(input.turnDispatch.requestId, {
				...(input.requestObservabilityFact.stageTiming ?? {}),
			});
			if (input.conversationSeed) {
				conversation.id = input.conversationSeed.id;
				conversation.ownerUserId = input.conversationSeed.ownerUserId;
				conversation.createdAt = input.conversationSeed.createdAt;
			}
			conversation.title = input.conversationTitle;
			conversation.updatedAt = input.userMessage.createdAt;
			conversation.activeBranchId = input.userMessage.branchId ?? "branch_active";
			conversation.activeMessageId = input.userMessage.id;
			conversation.activeRequestId = input.turnDispatch.requestId;
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
			return { memorySnapshot };
		}),
		finalizeRequest: vi.fn(async (input: FinalizeRequestWrite) => {
			const existing = finalWrites.find(
				(write) => write.turnDispatch.requestId === input.turnDispatch.requestId,
			);
			if (
				input.finalizationFingerprint &&
				(existing?.finalizationFingerprint || existing?.turnDispatch.completedAt)
			) {
				const existingCompletedAt = existing.turnDispatch.completedAt
					? new Date(existing.turnDispatch.completedAt).valueOf()
					: Number.NaN;
				const requestedCompletedAt = input.turnDispatch.completedAt
					? new Date(input.turnDispatch.completedAt).valueOf()
					: Number.NaN;
				if (
					!existing.finalizationFingerprint ||
					existing.finalizationFingerprint !== input.finalizationFingerprint ||
					!Number.isFinite(existingCompletedAt) ||
					!Number.isFinite(requestedCompletedAt) ||
					existingCompletedAt !== requestedCompletedAt
				) {
					throw new ChatFinalizationConflict();
				}
				return { conversation: structuredClone(conversation), outcome: "replayed" as const };
			}
			finalWrites.push(input);
			requestStageTiming.set(input.turnDispatch.requestId, {
				...(input.requestObservabilityFact.stageTiming ?? {}),
			});
			const isActiveRequest =
				conversation.activeRequestId === input.turnDispatch.requestId &&
				conversation.activeTurnSequence === input.turnDispatch.turnSequence;
			if (isActiveRequest) {
				conversation.title = input.conversationTitle;
				conversation.updatedAt = input.assistantMessage.createdAt;
				conversation.activeBranchId = input.assistantMessage.branchId ?? "branch_active";
				conversation.activeMessageId = input.assistantMessage.id;
				conversation.activeRequestId = null;
				conversation.activeTurnSequence = input.turnDispatch.turnSequence;
				for (const message of conversation.messages) {
					if (message.branchId === conversation.activeBranchId) {
						message.isActiveBranchHead = false;
					}
				}
			}
			if (isActiveRequest && input.sessionSlots.length > 0) {
				const updatedNames = new Set(input.sessionSlots.map((slot) => slot.name));
				conversation.sessionSlots = conversation.sessionSlots
					.filter((slot) => !updatedNames.has(slot.name))
					.concat(input.sessionSlots.map((slot) => ({ ...slot })));
			}
			conversation.messages.push({
				...input.assistantMessage,
				isActiveBranchHead: isActiveRequest,
			});
			return { conversation: structuredClone(conversation), outcome: "applied" as const };
		}),
		findIdempotentRequest: vi.fn(async () => null),
		recordStreamAppApiTtft: vi.fn(async (input) => {
			if (!requestStageTiming.has(input.requestId)) {
				return false;
			}
			const current = requestStageTiming.get(input.requestId) ?? {};
			if ("stream.app_api_ttft_ms" in current) {
				return false;
			}
			const next: Record<string, unknown> = {
				...current,
				"stream.app_api_ttft_ms": input.durationMs,
			};
			const workflowFirstDeltaMs = next["workflow.first_delta_ms"];
			if (
				typeof workflowFirstDeltaMs === "number" &&
				Number.isFinite(workflowFirstDeltaMs) &&
				workflowFirstDeltaMs >= 0 &&
				input.durationMs >= workflowFirstDeltaMs
			) {
				next["stream.orchestration_overhead_ms"] = input.durationMs - workflowFirstDeltaMs;
			}
			requestStageTiming.set(input.requestId, next);
			return true;
		}),
		readRequestStageTiming: vi.fn(async (requestId) => {
			const timing = requestStageTiming.get(requestId);
			if (!timing) {
				throw new Error(`Request observability fact ${requestId} was not found.`);
			}
			return { ...timing };
		}),
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
						write.turnDispatch.requestId &&
						(!input?.requestId || write.turnDispatch.requestId === input.requestId),
				);
			if (!accepted?.turnDispatch.requestId) {
				return [];
			}
			const snapshot = accepted.turnDispatch.principalSnapshot;
			const finalized = finalWrites.find(
				(write) => write.turnDispatch.requestId === accepted.turnDispatch.requestId,
			);
			return [
				{
					acceptedAt: accepted.turnDispatch.createdAt,
					assistantMessageId: accepted.turnDispatch.assistantMessageId,
					completedAt: finalized?.turnDispatch.completedAt ?? null,
					conversation: structuredClone(conversation),
					conversationTitle: accepted.conversationTitle,
					finalizationFingerprint: finalized?.finalizationFingerprint ?? null,
					idempotencyKey: accepted.turnDispatch.idempotencyKey,
					principal: {
						actor: snapshot.actor,
						...(snapshot.authorization ? { authorization: snapshot.authorization } : {}),
						permissions: { chat: true },
						principal: { ...snapshot.principal, email: null },
						session: null,
					},
					questionPreview: accepted.userMessage.text,
					requestFingerprintSha256: accepted.turnDispatch.requestFingerprintSha256,
					requestId: accepted.turnDispatch.requestId,
					safetyIdentifier: accepted.turnDispatch.safetyIdentifier ?? null,
					surface: accepted.turnDispatch.surface,
					turnSequence: accepted.turnDispatch.turnSequence,
					userMessageId: accepted.turnDispatch.userMessageId,
				},
			];
		}),
	};

	return {
		acceptedWrites,
		conversation,
		finalWrites,
		frozenMemorySnapshots,
		requestStageTiming,
		store,
	};
}

export function createExecutionRuntimeFromToolClient(
	client: ToolExecutionClient,
	options: {
		loadExecutionInput?: (requestId: string) => Promise<string | null>;
		onProductFinalization?: (input: {
			completedAt: string;
			response: ToolExecutionResponse;
			requestId: string;
		}) => Promise<void>;
		skipProductCallback?: boolean;
	} = {},
): ExecutionControlRuntimeClient {
	const eventsByRequest = new Map<string, ExecutionControlRunEvent[]>();
	const requestsById = new Map<string, ExecutionControlRun>();

	async function createRun(input: ExecutionControlRunCreateInput): Promise<ExecutionControlRun> {
		if (!frozenExecutionInputsByRequest.has(input.requestId) && options.loadExecutionInput) {
			const frozenExecutionInput = await options.loadExecutionInput(input.requestId);
			if (frozenExecutionInput) {
				frozenExecutionInputsByRequest.set(input.requestId, frozenExecutionInput);
			}
		}
		const executionInput = toolExecutionInputFromRunCreate(input);
		const run = durableRunFromCreateInput(input);
		requestsById.set(input.requestId, run);
		if (client.executeStream) {
			const response = await client.executeStream(executionInput);
			const events = await durableEventsFromExecutionSse(input, response);
			if (!options.skipProductCallback) {
				await applyTestProductCallback(input.requestId, events, options.onProductFinalization);
			}
			eventsByRequest.set(input.requestId, events);
			return run;
		}
		const response = await client.execute(executionInput);
		const events = [finalizationEventFromResponse(input, response, 1)];
		if (!options.skipProductCallback) {
			await applyTestProductCallback(input.requestId, events, options.onProductFinalization);
		}
		eventsByRequest.set(input.requestId, events);
		return run;
	}

	const runtime: ExecutionControlRuntimeClient & { [runtimeHandlesProductCallback]?: boolean } = {
		cancelRun: vi.fn(async (input) => {
			const existing = requestsById.get(input.requestId);
			if (!existing) {
				throw new Error(`Unknown durable run: ${input.requestId}`);
			}
			const cancelled = {
				...existing,
				completedAt: existing.updatedAt,
				status: "cancelled",
				terminalReason: input.reason,
			};
			requestsById.set(input.requestId, cancelled);
			return cancelled;
		}),
		createRun: vi.fn(createRun),
		getRun: vi.fn(async (input) => {
			const existing = requestsById.get(input.requestId);
			if (!existing) {
				throw new Error(`Unknown durable run: ${input.requestId}`);
			}
			return existing;
		}),
		listRunEvents: vi.fn(async (input) => {
			const events = (eventsByRequest.get(input.requestId) ?? []).filter(
				(event) => event.sequence > (input.afterSequence ?? 0),
			);
			return {
				events,
				nextSequence: events.at(-1)?.sequence ?? input.afterSequence ?? 0,
			};
		}),
	};
	runtime[runtimeHandlesProductCallback] = true;
	return runtime;
}

async function applyTestProductCallback(
	requestId: string,
	events: ExecutionControlRunEvent[],
	directCallback?: (input: {
		completedAt: string;
		response: ToolExecutionResponse;
		requestId: string;
	}) => Promise<void>,
): Promise<void> {
	const callback = pendingProductCallbacks.get(requestId);
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
		const code = getString(error?.code);
		const message = getString(error?.message);
		if (!(code && message && typeof error?.retryable === "boolean")) {
			throw new Error("run.failed error code, message, and retryable are required");
		}
		response = executionErrorResponse({
			code,
			message,
			retryable: error.retryable,
		});
	} else {
		response = executionErrorResponse({
			code: "execution_cancelled",
			message: "The request was cancelled.",
			retryable: false,
			status: "cancelled",
		});
	}
	if (directCallback) {
		await directCallback({
			completedAt: terminal.occurredAt,
			response,
			requestId,
		});
		return;
	}
	await callback?.(response, terminal.occurredAt);
}

function toolExecutionInputFromRunCreate(
	input: ExecutionControlRunCreateInput,
): ToolExecutionInput {
	const frozenJson = frozenExecutionInputsByRequest.get(input.requestId);
	if (!frozenJson) {
		throw new Error(`Missing frozen execution input for ${input.requestId}.`);
	}
	const payload = getRecordOrThrow(JSON.parse(frozenJson), "frozen execution payload");
	const context = internalContextFromWire(
		getRecordOrThrow(payload.context, "execution payload context"),
	);
	return {
		context: context as ToolExecutionInput["context"],
		conversationId: getString(payload.conversation_id) ?? input.conversationId,
		requestId: getString(payload.request_id) ?? input.requestId,
		safetyIdentifier: getString(payload.safety_identifier),
		surface: input.surface,
		tenantId: getString(payload.tenant_id),
		userGoal: getString(payload.user_goal) ?? "",
	};
}

function internalContextFromWire(wire: Record<string, unknown>): ToolExecutionInput["context"] {
	const actor = internalActorFromWire(getRecordOrThrow(wire.actor, "execution context actor"));
	const authorizationWire = getRecordOrThrow(wire.authorization, "execution context authorization");
	const memoryWire = getRecord(wire.memory);
	const sessionWire = getRecordOrThrow(wire.session, "execution context session");
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
			turnCount: typeof sessionWire.turn_count === "number" ? sessionWire.turn_count : 0,
		},
	};
}

function internalActorFromWire(
	wire: Record<string, unknown>,
): ToolExecutionInput["context"]["actor"] {
	const cohort = getString(wire.cohort);
	const major = getString(wire.major);
	const program = getString(wire.program);
	return {
		...(cohort ? { cohort } : {}),
		departments: getStringArray(wire.departments),
		...(major ? { major } : {}),
		principalId: getString(wire.principal_id) ?? "",
		principalType: appPrincipalType(wire.principal_type),
		...(program ? { program } : {}),
		roles: getStringArray(wire.roles),
		userId: getString(wire.user_id) ?? "",
	};
}

function durableRunFromCreateInput(input: ExecutionControlRunCreateInput): ExecutionControlRun {
	const now = "2026-06-04T01:02:03.000Z";
	const frozenJson = frozenExecutionInputsByRequest.get(input.requestId);
	if (!frozenJson) {
		throw new Error(`Missing frozen execution input for ${input.requestId}.`);
	}
	getRecordOrThrow(JSON.parse(frozenJson), "frozen execution payload");
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
		startedAt: "",
		status: "queued",
		streamingStartedAt: "",
		surface: input.surface,
		taskQueue: "campus-agent.workflow",
		terminalReason: "",
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
						}),
					),
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
				},
				sequence,
			});
		}
		const response = executionErrorResponse({
			code,
			message,
			retryable,
		});
		return baseRunEvent(input, {
			eventType: "finalization.completed",
			occurredAt: getString(parsed.data.occurred_at) ?? "",
			payload: {
				request_id: getString(parsed.data.request_id) ?? input.requestId,
				response: responseWireFromToolResponse(response),
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
		eventId: `${input.requestId}:event:${overrides.sequence}`,
		eventType: overrides.eventType,
		occurredAt: overrides.occurredAt || "2026-06-04T01:02:04.000Z",
		payload: overrides.payload,
		payloadSchemaVersion: "run-event-v1",
		requestId: input.requestId,
		sequence: overrides.sequence,
		visibility: overrides.visibility ?? "browser",
	};
}

function responseWireFromToolResponse(response: ToolExecutionResponse): Record<string, unknown> {
	return {
		answer_text: response.answerText,
		error: response.error
			? {
					code: response.error.code,
					message: response.error.message,
					retryable: response.error.retryable,
				}
			: null,
		model_usage: {
			cached_input_tokens: response.modelUsage.cachedInputTokens,
			input_tokens: response.modelUsage.inputTokens,
			output_tokens: response.modelUsage.outputTokens,
			total_tokens: response.modelUsage.totalTokens,
		},
		...(response.observability
			? { observability: observabilityWireFromToolResponse(response.observability) }
			: {}),
		result: response.result ?? null,
		status: response.status,
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
}): ToolExecutionResponse {
	return {
		answerText: "",
		error: {
			code: input.code,
			message: input.message,
			retryable: input.retryable,
		},
		modelUsage: { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
		result: null,
		status: input.status ?? "error",
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
