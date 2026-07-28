import { createHash } from "node:crypto";

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
	dispatchPendingChatAdmissions,
	executionRunAdmissionTimestamp,
} from "./admission-dispatcher";
import {
	startDurableFinalizationCloseout,
	waitForDurableFinalizationResponse,
} from "./service/durable";
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
import { acceptedCloseoutContext } from "./service/product-finalization";
import { toTerminalChatStreamEvent } from "./service/stream";
import {
	type AcceptedChatCommandContext,
	type ChatCommandResponse,
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
import { ChatFinalizationConflict } from "./store-types";

export { deriveSafetyIdentifier, deriveSafetyIdentifierForUser } from "./service/normalize";
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
		const acceptedWrite = buildAcceptedWrite({
			assistantMessageId,
			captureMemorySnapshot: dependencies.profileMemoryStore !== undefined,
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

		const acceptedState = await dependencies.store.acceptRequest(acceptedWrite);

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

	async function buildExecutionInput(
		context: AcceptedChatCommandContext,
	): Promise<ToolExecutionInput> {
		const traceHeaders = await ensureLangfuseTraceParent(context.traceId);
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
				memory: context.memorySnapshot
					? {
							appendEnabled: context.memorySnapshot.appendEnabled,
							ownerGeneration: context.memorySnapshot.ownerGeneration,
							ownerSequence: context.memorySnapshot.ownerSequence,
							recallEnabled: context.memorySnapshot.recallEnabled,
						}
					: null,
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
		pendingAdmission: boolean;
		response: ToolExecutionResponse | null;
		transportError: { code: string; retryable: boolean } | null;
	}> {
		if (!dependencies.executionRuntime) {
			return {
				pendingAdmission: false,
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
			const admissionInput = {
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
			};
			const workflowId = `campus-agent.chat.${context.runId}`;
			const workflowInputSha256 = createHash("sha256")
				.update(JSON.stringify(admissionInput), "utf8")
				.digest("hex");
			const recorded = await dependencies.store.recordAdmissionInput({
				requestId: context.requestId,
				updatedAt: now().toISOString(),
				workflowId,
				workflowInput: admissionInput,
				workflowInputSha256,
			});
			if (!recorded) {
				throw new Error("Chat admission input could not be frozen from pending_input state.");
			}
			const run = await dependencies.executionRuntime.createRun(admissionInput);
			await dependencies.store.markAdmitted({
				admittedAt: executionRunAdmissionTimestamp(run),
				requestId: context.requestId,
				workflowId,
			});
			context.runPhase = runtimeRunPhaseFromExecutionStatus(run.status);
			return {
				pendingAdmission: false,
				response: null,
				transportError: null,
			};
		} catch (error) {
			const handled = toHandledErrorTransportOutcome(error);
			const pendingAdmission = error instanceof ExecutionControlTransportError && error.retryable;
			return {
				pendingAdmission,
				response: pendingAdmission
					? null
					: {
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
		const finalized = buildFinalizedWrite({
			allowedPublicNoticeHosts: dependencies.publicNoticeURLAllowlist,
			assistantMessageId: context.assistantMessageId,
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

	async function readProductFinalizedCommand(input: {
		context: AcceptedChatCommandContext;
		executionResponse: ToolExecutionResponse;
	}): Promise<ChatCommandResponse> {
		const { context } = input;
		const completedAt = now().toISOString();
		const finalized = buildFinalizedWrite({
			allowedPublicNoticeHosts: dependencies.publicNoticeURLAllowlist,
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
			requestedTool: context.validatedPayload.requestedTool,
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
		terminalObserved: boolean;
		transportError: { code: string; retryable: boolean } | null;
	}> {
		const traceHeaders = await ensureLangfuseTraceParent(input.context.traceId);
		try {
			return await waitForDurableFinalizationResponse({
				context: input.context,
				listRunEvents: (afterSequence, waitMs) =>
					input.executionRuntime.listRunEvents({
						afterSequence,
						runId: input.context.runId ?? "",
						traceHeaders,
						traceId: input.context.traceId,
						waitMs,
					}),
				polling: dependencies.durableEventPolling,
			});
		} catch (error) {
			const handled = toHandledErrorTransportOutcome(error);
			return {
				response: handled,
				terminalObserved: false,
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
		async dispatchPendingAdmissions() {
			if (!dependencies.executionRuntime) {
				return { admitted: 0, failed: 0, processed: 0 };
			}
			return dispatchPendingChatAdmissions({
				executionRuntime: dependencies.executionRuntime,
				store: dependencies.store,
			});
		},
		async applyProductFinalization(input) {
			const candidates = await dependencies.store.listAcceptedDurableRequestsForCloseout({
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
			if (
				candidate.finalizationFingerprint &&
				candidate.finalizationFingerprint !== input.finalizationFingerprint
			) {
				throw new ChatFinalizationConflict();
			}
			if (input.response.traceId !== candidate.traceId) {
				throw new ChatFinalizationConflict();
			}
			const replayed = candidate.finalizationFingerprint === input.finalizationFingerprint;
			const context = acceptedCloseoutContext(candidate);
			const durationMs = Math.max(
				0,
				new Date(input.completedAt).valueOf() - new Date(candidate.acceptedAt).valueOf(),
			);
			const finalized = buildFinalizedWrite({
				allowedPublicNoticeHosts: dependencies.publicNoticeURLAllowlist,
				assistantMessageId: candidate.assistantMessageId,
				branchId: context.branchId,
				completedAt: input.completedAt,
				conversation: context.conversation,
				conversationTitle: context.conversationTitle,
				durationMs,
				principal: context.input.principal,
				requestId: context.requestId,
				requestedTool: context.validatedPayload.requestedTool,
				response: input.response,
				runId: context.runId,
				safetyIdentifier: context.safetyIdentifier,
				surface: context.surface,
				startedAt: context.acceptedAt,
				traceId: context.traceId,
				turnSequence: context.turnSequence,
				userMessageId: context.userMessageId,
			});
			finalized.write.finalizationFingerprint = input.finalizationFingerprint;
			await dependencies.store.finalizeRequest(finalized.write);
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
				sourceDocIds: extractSourceDocIds(input.response.result),
				stageTiming: finalized.write.requestObservabilityFact.stageTiming,
				status: finalized.write.turnDispatch.status,
				surface: context.surface,
				traceId: context.traceId,
			});
			return { outcome: replayed ? "replayed" : "applied" };
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
			if (durableRunCreate.pendingAdmission) {
				throw createPreAcceptError({
					code: "admission_pending",
					details: { requestId: accepted.value.requestId, runId: accepted.value.runId },
					message: "The request was accepted and is waiting for execution admission.",
					retryable: true,
					status: 503,
				});
			}
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
				if (!execution.terminalObserved) {
					throw createPreAcceptError({
						code: "execution_status_pending",
						details: { requestId: accepted.value.requestId, runId: accepted.value.runId },
						message: "The request is still running and can be resumed.",
						retryable: true,
						status: 504,
					});
				}
				return readProductFinalizedCommand({
					context: accepted.value,
					executionResponse: execution.response,
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
				if (durableRunCreate.pendingAdmission) {
					yield acceptedStreamEvent(context);
					yield {
						data: {
							occurredAt: now().toISOString(),
							requestId: context.requestId,
							runId: context.runId,
							status: "pending_admission",
							traceId: context.traceId,
						},
						event: "execution.queued",
					};
					return;
				}
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

				const traceHeaders = await ensureLangfuseTraceParent(context.traceId);
				const closeout = startDurableFinalizationCloseout({
					context,
					finalizeAcceptedCommand: ({ context: closeoutContext, executionResponse }) =>
						readProductFinalizedCommand({ context: closeoutContext, executionResponse }),
					listRunEvents: (afterSequence, waitMs) =>
						executionRuntime.listRunEvents({
							afterSequence,
							runId: context.runId ?? "",
							traceHeaders,
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
