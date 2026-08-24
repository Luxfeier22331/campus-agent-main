import { type ChatConversation, DRAFT_CONVERSATION_TITLE } from "../../chat";
import type { ToolExecutionInput } from "../../integration";
import { DEFAULT_PERSONAL_MEMORY_TENANT_ID } from "../../personalization/tenant";
import { ensureLangfuseTraceParent } from "../../telemetry/trace";
import {
	ChatAcceptanceConversationConflict,
	ChatAcceptanceIdempotencyConflict,
} from "../store-types";
import type { ChatCommandServiceContext } from "./context";
import { freezeToolExecutionRunInput } from "./durable-metadata";
import { createPreAcceptError } from "./errors";
import { resolveValidatedPayload } from "./normalize";
import {
	type AcceptedChatCommandContext,
	type ChatCommandResponse,
	type ChatCommandSubmitInput,
	NEW_CONVERSATION_FINGERPRINT_SCOPE,
} from "./types";
import {
	buildAcceptedWrite,
	buildConversationTitle,
	buildToolExecutionContextProjection,
} from "./writes";

export type AcceptChatCommandResult =
	| { kind: "accepted"; value: AcceptedChatCommandContext }
	| {
			acceptedAt: string;
			kind: "accepted_replay";
			requestId: string;
			runId: string;
			traceId: string;
	  }
	| { kind: "existing"; response: ChatCommandResponse };

export async function acceptChatCommand(
	service: ChatCommandServiceContext,
	input: ChatCommandSubmitInput,
): Promise<AcceptChatCommandResult> {
	const {
		computeFingerprint,
		dependencies,
		deriveSafetyIdentifierForPrincipal,
		generateId,
		now,
		telemetry,
	} = service;
	if (!input.principal.permissions.chat) {
		throw createPreAcceptError({
			code: "forbidden",
			message: "Chat access is not available for this principal.",
			status: 403,
		});
	}

	const requestKind = input.requestKind ?? "public_chat";
	const surface = requestKind === "internal_eval" ? "eval_benchmark" : "campus_web";
	const validatedPayload = resolveValidatedPayload(input.payload);
	if (!(dependencies.executionRuntime && dependencies.isExecutionRuntimeConfigured !== false)) {
		throw createPreAcceptError({
			code: "execution_runtime_required",
			message: "Execution runtime is required for this environment.",
			retryable: true,
			status: 503,
		});
	}
	const ownerUserId = input.principal.principal.principalId;

	let conversation: ChatConversation | null = null;
	let conversationDiscriminator = NEW_CONVERSATION_FINGERPRINT_SCOPE;

	if (validatedPayload.conversationId) {
		conversationDiscriminator = validatedPayload.conversationId;
		conversation = await dependencies.conversationStore.getConversationByOwner(
			ownerUserId,
			validatedPayload.conversationId,
		);
		if (conversation) {
			conversationDiscriminator = conversation.id;
		}
	}

	const idempotencyKey = input.idempotencyKey?.trim() || null;
	if (!idempotencyKey) {
		throw createPreAcceptError({
			code: "idempotency_key_required",
			message: "Idempotency-Key is required for chat requests.",
			retryable: false,
			status: 400,
		});
	}
	const requestFingerprintSha256 = idempotencyKey
		? computeFingerprint({
				conversationDiscriminator,
				prompt: validatedPayload.prompt,
			})
		: null;
	const resolveIdempotentRequest = (
		existing: NonNullable<
			Awaited<ReturnType<typeof dependencies.commandStore.findIdempotentRequest>>
		>,
	): AcceptChatCommandResult => {
		if (existing.requestFingerprintSha256 !== requestFingerprintSha256) {
			throw createPreAcceptError({
				code: "idempotency_conflict",
				message: "Idempotency key conflicts with a different request.",
				status: 409,
			});
		}

		if (existing.status === "accepted") {
			if (!existing.runId) {
				throw new Error("Accepted idempotent replay is missing its durable run id.");
			}
			return {
				acceptedAt: existing.acceptedAt,
				kind: "accepted_replay",
				requestId: existing.response.requestId,
				runId: existing.runId,
				traceId: existing.response.traceId,
			};
		}

		return { kind: "existing", response: existing.response };
	};

	if (idempotencyKey && requestFingerprintSha256) {
		const existing = await dependencies.commandStore.findIdempotentRequest({
			actorUserId: input.principal.actor.userId,
			idempotencyKey,
		});
		if (existing) {
			return resolveIdempotentRequest(existing);
		}
	}

	const requestId = generateId("req");
	const traceId = generateId("trace");
	const runId = generateId("run");
	const turnId = generateId("turn");
	const safetyIdentifier = deriveSafetyIdentifierForPrincipal(input.principal);
	const acceptedAt = now().toISOString();
	const userMessageId = generateId("msg");
	const assistantMessageId = generateId("msg");
	const branchId = conversation?.activeBranchId ?? "branch_active";

	let conversationSeed:
		| {
				id: string;
				ownerUserId: string;
				title: string;
				createdAt: string;
				updatedAt: string;
		  }
		| undefined;

	if (!conversation) {
		const conversationId = validatedPayload.conversationId ?? generateId("conv");
		const title = buildConversationTitle(DRAFT_CONVERSATION_TITLE, validatedPayload.prompt);
		conversationSeed = {
			id: conversationId,
			ownerUserId,
			title,
			createdAt: acceptedAt,
			updatedAt: acceptedAt,
		};
		conversation = {
			id: conversationId,
			ownerUserId,
			title,
			createdAt: acceptedAt,
			updatedAt: acceptedAt,
			activeBranchId: branchId,
			activeMessageId: null,
			activeRunId: null,
			activeTurnSequence: 0,
			sessionSlots: [],
			messages: [],
		};
	}

	const turnSequence =
		Math.max(conversation.activeTurnSequence ?? 0, conversation.messages.length) + 1;
	const conversationTitle = buildConversationTitle(conversation.title, validatedPayload.prompt);
	const traceHeaders = await ensureLangfuseTraceParent(traceId);
	const acceptedWrite = buildAcceptedWrite({
		assistantMessageId,
		branchId,
		conversation,
		...(conversationSeed ? { conversationSeed } : {}),
		conversationTitle,
		freezeDurableRun(memorySnapshot) {
			const executionInput: ToolExecutionInput = {
				context: buildToolExecutionContextProjection({
					actor: input.principal.actor,
					authorization: input.principal.authorization,
					conversation,
					currentUserMessageContent: validatedPayload.prompt,
					currentUserMessageCreatedAt: acceptedAt,
					currentUserMessageId: userMessageId,
					memory: memorySnapshot
						? {
								appendEnabled: memorySnapshot.appendEnabled,
								ownerGeneration: memorySnapshot.ownerGeneration,
								ownerSequence: memorySnapshot.ownerSequence,
								recallEnabled: memorySnapshot.recallEnabled,
							}
						: null,
					sessionSlots: conversation.sessionSlots,
					turnCount: conversation.messages.length + 1,
				}),
				conversationId: conversation.id,
				requestId,
				safetyIdentifier,
				surface,
				tenantId: DEFAULT_PERSONAL_MEMORY_TENANT_ID,
				traceHeaders,
				traceId,
				userGoal: validatedPayload.prompt,
			};
			const frozenInput = freezeToolExecutionRunInput(executionInput, runId);
			return {
				executionInputJson: frozenInput.executionInputJson,
				executionInputSha256: frozenInput.executionInputSha256,
				turnId,
			};
		},
		idempotencyKey,
		now: acceptedAt,
		principal: input.principal,
		prompt: validatedPayload.prompt,
		requestFingerprintSha256,
		requestId,
		requestKind,
		runId,
		safetyIdentifier,
		surface,
		traceId,
		turnId,
		turnSequence,
		userMessageId,
	});

	telemetry?.configureChatRequestScope({
		requestId,
		surface,
		traceId,
	});

	let acceptedState: Awaited<ReturnType<typeof dependencies.commandStore.acceptRequest>>;
	try {
		acceptedState = await dependencies.commandStore.acceptRequest(acceptedWrite);
	} catch (error) {
		if (error instanceof ChatAcceptanceConversationConflict) {
			throw createPreAcceptError({
				code: "conversation_changed",
				message: "The conversation changed while this request was being accepted.",
				retryable: true,
				status: 409,
			});
		}
		if (
			error instanceof ChatAcceptanceIdempotencyConflict &&
			idempotencyKey &&
			requestFingerprintSha256
		) {
			const existing = await dependencies.commandStore.findIdempotentRequest({
				actorUserId: input.principal.actor.userId,
				idempotencyKey,
			});
			if (existing) {
				return resolveIdempotentRequest(existing);
			}
		}
		throw error;
	}

	return {
		kind: "accepted",
		value: {
			acceptedAt,
			assistantMessageId,
			branchId,
			conversation,
			conversationTitle,
			idempotencyKey,
			input,
			memorySnapshot: acceptedState.memorySnapshot,
			requestFingerprintSha256,
			requestId,
			runId,
			runPhase: null,
			safetyIdentifier,
			surface,
			traceId,
			turnId,
			turnSequence,
			userMessageId,
			validatedPayload,
		},
	};
}
