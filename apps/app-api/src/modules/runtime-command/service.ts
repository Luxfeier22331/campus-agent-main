import { type ChatConversation, DRAFT_CONVERSATION_TITLE, toConversationResponse } from "../chat";
import {
	ExecutionControlTransportError,
	type ToolExecutionInput,
	type ToolExecutionResponse,
} from "../integration";
import { DEFAULT_PERSONAL_MEMORY_TENANT_ID } from "../personalization/tenant";
import { runtimeRunPhaseFromExecutionStatus } from "../runtime-run";
import { ensureLangfuseTraceParent } from "../telemetry/trace";

import {
	startDurableFinalizationCloseout,
	waitForDurableFinalizationResponse,
} from "./service/durable";
import { reconcileDurableCloseouts } from "./service/durable-closeout";
import { buildToolExecutionRunMetadata } from "./service/durable-metadata";
import {
	buildAbuseThrottleRejectedResponse,
	createPreAcceptError,
	toHandledErrorTransportOutcome,
} from "./service/errors";
import {
	defaultComputeFingerprint,
	defaultGenerateId,
	deriveSafetyIdentifier,
	extractSourceDocIds,
	resolveValidatedPayload,
} from "./service/normalize";
import { toTerminalChatStreamEvent } from "./service/stream";
import {
	type AcceptedChatCommandContext,
	type ChatCommandService,
	type ChatCommandServiceDependencies,
	type ChatCommandStreamEvent,
	type ChatCommandSubmitInput,
	NEW_CONVERSATION_FINGERPRINT_SCOPE,
} from "./service/types";
import {
	buildAcceptedWrite,
	buildConversationTitle,
	buildFinalizedWrite,
	buildToolExecutionContextProjection,
} from "./service/writes";

export { deriveSafetyIdentifier } from "./service/normalize";
export type {
	ChatCommandPayload,
	ChatCommandResponse,
	ChatCommandResult,
	ChatCommandService,
	ChatCommandServiceDependencies,
	ChatCommandStreamEvent,
} from "./service/types";

type AcceptChatCommandResult =
	| { kind: "accepted"; value: AcceptedChatCommandContext }
	| { kind: "existing"; response: import("./service/types").ChatCommandResponse };

export function buildChatCommandService(
	dependencies: ChatCommandServiceDependencies,
): ChatCommandService {
	const computeFingerprint = dependencies.computeFingerprint ?? defaultComputeFingerprint;
	const deriveSafetyIdentifierForPrincipal =
		dependencies.deriveSafetyIdentifier ??
		((principal: Parameters<typeof deriveSafetyIdentifier>[0]) =>
			deriveSafetyIdentifier(principal, dependencies.safetyIdentifierHmacSecret ?? ""));
	const generateId = dependencies.generateId ?? defaultGenerateId;
	const now = dependencies.now ?? (() => new Date());
	const telemetry = dependencies.telemetry;

	async function acceptCommand(input: ChatCommandSubmitInput): Promise<AcceptChatCommandResult> {
		if (!input.principal.permissions.chat) {
			throw createPreAcceptError({
				code: "forbidden",
				message: "Chat access is not available for this principal.",
				status: 403,
			});
		}

		const requestKind = input.requestKind ?? "public_chat";
		const surface = requestKind === "internal_eval" ? "eval_benchmark" : "campus_web";
		const validatedPayload = resolveValidatedPayload(input.payload, { requestKind });
		if (
			dependencies.requireExecutionRuntime &&
			!(dependencies.executionRuntime && dependencies.isExecutionRuntimeConfigured !== false)
		) {
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
		const requestFingerprintSha256 = idempotencyKey
			? computeFingerprint({
					conversationDiscriminator,
					prompt: validatedPayload.prompt,
					requestedTool: validatedPayload.requestedTool,
				})
			: null;

		if (idempotencyKey && requestFingerprintSha256) {
			const existing = await dependencies.store.findIdempotentRequest({
				actorUserId: input.principal.actor.userId,
				idempotencyKey,
			});
			if (existing) {
				if (existing.requestFingerprintSha256 !== requestFingerprintSha256) {
					throw createPreAcceptError({
						code: "idempotency_conflict",
						message: "Idempotency key conflicts with a different request.",
						status: 409,
					});
				}

				if (existing.status === "accepted") {
					throw createPreAcceptError({
						code: "request_in_progress",
						message: "A matching request is still in progress.",
						status: 409,
					});
				}

				return { kind: "existing", response: existing.response };
			}
		}

		const requestId = generateId("req");
		const traceId = generateId("trace");
		const runId = dependencies.executionRuntime ? generateId("run") : null;
		const turnId = dependencies.executionRuntime ? generateId("turn") : null;
		const safetyIdentifier = deriveSafetyIdentifierForPrincipal(input.principal);
		const acceptedAt = now().toISOString();
		const userMessageId = generateId("msg");
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
		const acceptedWrite = buildAcceptedWrite({
			branchId,
			conversation,
			conversationSeed,
			conversationTitle,
			idempotencyKey,
			now: acceptedAt,
			principal: input.principal,
			prompt: validatedPayload.prompt,
			requestFingerprintSha256,
			requestId,
			requestedTool: validatedPayload.requestedTool,
			runId,
			safetyIdentifier,
			surface,
			traceId,
			turnSequence,
			userMessageId,
		});

		telemetry?.configureChatRequestScope({
			actor: {
				principalType: input.principal.principal.type,
				subject: input.principal.actor.userId,
			},
			conversationId: conversation.id,
			principalType: input.principal.principal.type,
			requestId,
			requestedTool: validatedPayload.requestedTool,
			safetyIdentifier,
			surface,
			traceId,
		});

		await dependencies.store.acceptRequest(acceptedWrite);

		await telemetry?.recordRequestAccepted({
			actor: {
				principalType: input.principal.principal.type,
				subject: input.principal.actor.userId,
			},
			conversationId: conversation.id,
			principalType: input.principal.principal.type,
			requestId,
			requestedTool: validatedPayload.requestedTool,
			safetyIdentifier,
			status: "accepted",
			surface,
			traceId,
		});
		return {
			kind: "accepted",
			value: {
				acceptedAt,
				branchId,
				conversation,
				conversationTitle,
				idempotencyKey,
				input,
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

	async function buildExecutionInput(
		context: AcceptedChatCommandContext,
	): Promise<ToolExecutionInput> {
		const profileMemorySummary = dependencies.profileMemoryStore
			? await dependencies.profileMemoryStore
					.loadSummary({ ownerUserId: context.input.principal.actor.userId })
					.catch((error) => {
						telemetry?.captureException(error, {
							route: "/api/chat/requests",
							surface: context.surface,
							traceId: context.traceId,
						});
						return null;
					})
			: null;
		const traceHeaders = ensureLangfuseTraceParent(
			context.input.traceHeaders ?? telemetry?.getTraceHeaders(),
			context.traceId,
		);
		const previousToolResults = await dependencies.store.listPreviousToolResultRefs({
			beforeTurnSequence: context.turnSequence,
			conversationId: context.conversation.id,
			limit: 3,
			ownerUserId: context.input.principal.actor.userId,
		});
		return {
			context: buildToolExecutionContextProjection({
				actor: context.input.principal.actor,
				authorization: context.input.principal.authorization,
				conversation: context.conversation,
				currentUserMessageContent: context.validatedPayload.prompt,
				currentUserMessageCreatedAt: context.acceptedAt,
				currentUserMessageId: context.userMessageId,
				memory: profileMemorySummary ? { enabled: profileMemorySummary.enabled } : null,
				previousToolResults,
				sessionSlots: context.conversation.sessionSlots,
				turnCount: context.conversation.messages.length + 1,
			}),
			conversationId: context.conversation.id,
			requestId: context.requestId,
			requestedTool: context.validatedPayload.requestedTool,
			safetyIdentifier: context.safetyIdentifier,
			surface: context.surface,
			tenantId: DEFAULT_PERSONAL_MEMORY_TENANT_ID,
			traceHeaders,
			traceId: context.traceId,
			userGoal: context.validatedPayload.prompt,
		};
	}

	async function createDurableRunForAcceptedCommand(context: AcceptedChatCommandContext): Promise<{
		response: ToolExecutionResponse | null;
		transportError: { code: string; retryable: boolean } | null;
	}> {
		if (!dependencies.executionRuntime) {
			return {
				response: null,
				transportError: null,
			};
		}
		if (!(context.runId && context.turnId)) {
			throw new ExecutionControlTransportError({
				code: "runtime_invariant_failed",
				message: "Execution runtime command is missing run or turn id.",
				retryable: false,
				status: 500,
			});
		}

		const executionInput = await buildExecutionInput(context);
		try {
			const durableMetadata = buildToolExecutionRunMetadata(executionInput);
			const run = await dependencies.executionRuntime.createRun({
				conversationId: context.conversation.id,
				metadata: durableMetadata,
				ownerUserId: context.input.principal.actor.userId,
				requestId: context.requestId,
				runId: context.runId,
				runtimeVersions: {
					contract: "durable-agent-runtime-contract-v1",
				},
				surface: context.surface,
				traceHeaders: executionInput.traceHeaders,
				traceId: context.traceId,
				turnId: context.turnId,
			});
			context.runPhase = runtimeRunPhaseFromExecutionStatus(run.status);
			return {
				response: null,
				transportError: null,
			};
		} catch (error) {
			const handled = toHandledErrorTransportOutcome(error);
			return {
				response: {
					...handled,
					traceId: context.traceId,
				},
				transportError: {
					code: handled.error.code,
					retryable: handled.error.retryable,
				},
			};
		}
	}

	async function getAbuseControlState(context: AcceptedChatCommandContext) {
		return context.safetyIdentifier
			? await dependencies.store.getAbuseControlState({
					now: context.acceptedAt,
					safetyIdentifier: context.safetyIdentifier,
					surface: context.surface,
				})
			: null;
	}

	async function recordTransportError(input: {
		context: AcceptedChatCommandContext;
		transportError: { code: string; retryable: boolean } | null;
	}) {
		if (!input.transportError) {
			return;
		}

		await telemetry?.recordRequestTransportError({
			conversationId: input.context.conversation.id,
			errorCode: input.transportError.code,
			principalType: input.context.input.principal.principal.type,
			requestId: input.context.requestId,
			requestedTool: input.context.validatedPayload.requestedTool,
			safetyIdentifier: input.context.safetyIdentifier,
			retryable: input.transportError.retryable,
			surface: input.context.surface,
			traceId: input.context.traceId,
		});
	}

	async function finalizeAcceptedCommand(input: {
		context: AcceptedChatCommandContext;
		executionResponse: ToolExecutionResponse;
		executionFinalizationReceivedAt?: string | null;
		streamBrowserTtftMs?: number | null;
		transportError?: { code: string; retryable: boolean } | null;
	}) {
		const { context } = input;
		await recordTransportError({
			context,
			transportError: input.transportError ?? null,
		});

		const completedAt = now().toISOString();
		const durationMs = Math.max(
			0,
			new Date(completedAt).valueOf() - new Date(context.acceptedAt).valueOf(),
		);
		const projectionCloseoutMs = input.executionFinalizationReceivedAt
			? Math.max(
					0,
					new Date(completedAt).valueOf() -
						new Date(input.executionFinalizationReceivedAt).valueOf(),
				)
			: null;
		const assistantMessageId = generateId("msg");
		const finalized = buildFinalizedWrite({
			allowedPublicNoticeHosts: dependencies.publicNoticeURLAllowlist,
			assistantMessageId,
			branchId: context.branchId,
			completedAt,
			conversation: context.conversation,
			conversationTitle: context.conversationTitle,
			durationMs,
			principal: context.input.principal,
			projectionCloseoutMs,
			requestId: context.requestId,
			requestedTool: context.validatedPayload.requestedTool,
			response: input.executionResponse,
			runId: context.runId,
			safetyIdentifier: context.safetyIdentifier,
			surface: context.surface,
			startedAt: context.acceptedAt,
			streamBrowserTtftMs: input.streamBrowserTtftMs,
			traceId: context.traceId,
			turnSequence: context.turnSequence,
			userMessageId: context.userMessageId,
		});

		const finalizedConversation = await dependencies.store.finalizeRequest(finalized.write);
		await telemetry?.recordRequestFinalized({
			conversationId: context.conversation.id,
			durationMs,
			errorCode: finalized.write.turnDispatch.errorCode,
			principalType: context.input.principal.principal.type,
			requestId: context.requestId,
			requestedTool: context.validatedPayload.requestedTool,
			resolvedTargets: finalized.write.turnDispatch.resolvedTargets,
			retryable: finalized.write.assistantMessage.retryable,
			safetyIdentifier: context.safetyIdentifier,
			selectedTool: finalized.write.turnDispatch.selectedTool,
			sourceDocIds: extractSourceDocIds(input.executionResponse.result),
			stageTiming: finalized.write.requestObservabilityFact.stageTiming,
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

		return {
			...finalized.responseBody,
			answer: {
				conversation: toConversationResponse(finalizedConversation),
				result: finalized.responseBody.answer.result,
			},
		};
	}

	function acceptedStreamEvent(context: AcceptedChatCommandContext): ChatCommandStreamEvent {
		return {
			data: {
				occurredAt: context.acceptedAt,
				requestId: context.requestId,
				runId: context.runId,
				...(context.runPhase ? { runPhase: context.runPhase } : {}),
				status: "accepted",
				traceId: context.traceId,
			},
			event: "request.accepted",
		};
	}

	function terminalStreamEventForExisting(
		response: import("./service/types").ChatCommandResponse,
	): ChatCommandStreamEvent {
		return toTerminalChatStreamEvent({
			occurredAt: now().toISOString(),
			response,
		});
	}

	async function executeDurableBlocking(input: {
		context: AcceptedChatCommandContext;
		executionRuntime: NonNullable<ChatCommandServiceDependencies["executionRuntime"]>;
	}): Promise<{
		response: ToolExecutionResponse;
		transportError: { code: string; retryable: boolean } | null;
	}> {
		try {
			return await waitForDurableFinalizationResponse({
				context: input.context,
				listRunEvents: (afterSequence, waitMs) =>
					input.executionRuntime.listRunEvents({
						afterSequence,
						runId: input.context.runId ?? "",
						traceHeaders: ensureLangfuseTraceParent(
							input.context.input.traceHeaders ?? telemetry?.getTraceHeaders(),
							input.context.traceId,
						),
						traceId: input.context.traceId,
						waitMs,
					}),
				polling: dependencies.durableEventPolling,
			});
		} catch (error) {
			const handled = toHandledErrorTransportOutcome(error);
			return {
				response: handled,
				transportError: {
					code: handled.error.code,
					retryable: handled.error.retryable,
				},
			};
		}
	}

	async function buildThrottleResponseIfNeeded(
		context: AcceptedChatCommandContext,
	): Promise<ToolExecutionResponse | null> {
		const abuseControlState = await getAbuseControlState(context);
		if (abuseControlState?.shouldThrottle) {
			return buildAbuseThrottleRejectedResponse({
				traceId: context.traceId,
			});
		}
		return null;
	}

	return {
		async reconcileDurableCloseouts(input = {}) {
			return reconcileDurableCloseouts({
				dependencies,
				finalizeAcceptedCommand,
				now,
				reconcileInput: input,
			});
		},

		async submit(input) {
			const accepted = await acceptCommand(input);
			if (accepted.kind === "existing") {
				return accepted.response;
			}

			const throttleResponse = await buildThrottleResponseIfNeeded(accepted.value);
			if (throttleResponse) {
				return finalizeAcceptedCommand({
					context: accepted.value,
					executionResponse: throttleResponse,
				});
			}
			const durableRunCreate = await createDurableRunForAcceptedCommand(accepted.value);
			if (durableRunCreate.response) {
				return finalizeAcceptedCommand({
					context: accepted.value,
					executionResponse: durableRunCreate.response,
					transportError: durableRunCreate.transportError,
				});
			}
			const executionRuntime = dependencies.executionRuntime;
			if (executionRuntime) {
				const execution = await executeDurableBlocking({
					context: accepted.value,
					executionRuntime,
				});
				return finalizeAcceptedCommand({
					context: accepted.value,
					executionResponse: execution.response,
					transportError: execution.transportError,
				});
			}
			throw createPreAcceptError({
				code: "execution_runtime_required",
				message: "Execution runtime is required for chat execution.",
				retryable: true,
				status: 503,
			});
		},

		async *submitStream(input) {
			const accepted = await acceptCommand(input);
			if (accepted.kind === "existing") {
				yield terminalStreamEventForExisting(accepted.response);
				return;
			}

			const context = accepted.value;
			const throttleResponse = await buildThrottleResponseIfNeeded(context);
			if (throttleResponse) {
				const finalized = await finalizeAcceptedCommand({
					context,
					executionResponse: throttleResponse,
				});
				yield toTerminalChatStreamEvent({
					occurredAt: now().toISOString(),
					response: finalized,
				});
				return;
			}

			const executionRuntime = dependencies.executionRuntime;
			if (executionRuntime) {
				const durableRunCreate = await createDurableRunForAcceptedCommand(context);
				if (durableRunCreate.response) {
					const finalized = await finalizeAcceptedCommand({
						context,
						executionResponse: durableRunCreate.response,
						transportError: durableRunCreate.transportError,
					});
					yield toTerminalChatStreamEvent({
						occurredAt: now().toISOString(),
						response: finalized,
					});
					return;
				}

				const closeout = startDurableFinalizationCloseout({
					context,
					finalizeAcceptedCommand,
					listRunEvents: (afterSequence, waitMs) =>
						executionRuntime.listRunEvents({
							afterSequence,
							runId: context.runId ?? "",
							traceHeaders: ensureLangfuseTraceParent(
								context.input.traceHeaders ?? telemetry?.getTraceHeaders(),
								context.traceId,
							),
							traceId: context.traceId,
							waitMs,
						}),
					now,
					polling: dependencies.durableEventPolling,
				});
				context.input.waitUntil?.(closeout.completion);
				yield acceptedStreamEvent(context);
				yield* closeout.streamEvents();
				return;
			}

			throw createPreAcceptError({
				code: "execution_runtime_required",
				message: "Execution runtime is required for chat execution.",
				retryable: true,
				status: 503,
			});
		},
	};
}
