import { type ChatConversation, DRAFT_CONVERSATION_TITLE, toConversationResponse } from "../chat";
import {
	ExecutionControlTransportError,
	type SupervisorExecutionInput,
	type SupervisorExecutionResponse,
} from "../integration";
import { type RuntimeRunPhase, runtimeRunPhaseFromSupervisorStatus } from "../runtime-run";

import {
	startDurableFinalizationCloseout,
	waitForDurableFinalizationResponse,
} from "./service/durable";
import { buildDurableRagRunMetadata } from "./service/durable-metadata";
import {
	buildAbuseThrottleRejectedResponse,
	createPreAcceptError,
	toHandledErrorTransportOutcome,
} from "./service/errors";
import {
	defaultComputeFingerprint,
	defaultGenerateId,
	deriveSafetyIdentifier,
	previewText,
	resolveValidatedPayload,
} from "./service/normalize";
import { toTerminalChatStreamEvent } from "./service/stream";
import {
	type ChatCommandService,
	type ChatCommandServiceDependencies,
	type ChatCommandStreamEvent,
	type ChatCommandSubmitInput,
	NEW_CONVERSATION_FINGERPRINT_SCOPE,
	type ValidatedChatCommandPayload,
} from "./service/types";
import {
	buildAcceptedWrite,
	buildConversationTitle,
	buildFinalizedWrite,
	buildSupervisorContextProjection,
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

interface AcceptedChatCommandContext {
	acceptedAt: string;
	conversation: ChatConversation;
	conversationTitle: string;
	idempotencyKey: string | null;
	input: ChatCommandSubmitInput;
	requestFingerprintSha256: string | null;
	requestId: string;
	runId: string | null;
	runPhase: RuntimeRunPhase | null;
	safetyIdentifier: string | null;
	surface: string;
	traceId: string;
	turnId: string | null;
	userMessageId: string;
	validatedPayload: ValidatedChatCommandPayload;
}

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

	async function recordTraceBacklink(input: {
		errorCode?: string | null;
		requestId: string;
		selectedTarget?: string | null;
		status?: string | null;
		surface: string;
		traceId: string;
		waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
	}) {
		if (!dependencies.traceBacklinkRecorder) {
			return;
		}

		const { waitUntil, ...recordInput } = input;
		const recordPromise = dependencies.traceBacklinkRecorder.record(recordInput).catch((error) => {
			telemetry?.captureException(error, {
				route: "/api/chat/requests",
				surface: input.surface,
				traceId: input.traceId,
			});
		});
		if (waitUntil) {
			waitUntil(recordPromise);
			return;
		}
		await recordPromise;
	}

	async function acceptCommand(input: ChatCommandSubmitInput): Promise<AcceptChatCommandResult> {
		if (!input.principal.permissions.chat) {
			throw createPreAcceptError({
				code: "forbidden",
				message: "Chat access is not available for this principal.",
				status: 403,
			});
		}

		const surface = input.surface?.trim() || "public_chat_web";
		const validatedPayload = resolveValidatedPayload(input.payload, { surface });
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
					requestedCapability: validatedPayload.requestedCapability,
					requestedScope: validatedPayload.requestedScope,
					versionQuery: validatedPayload.versionQuery,
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
		const acceptedEventId = generateId("evt");

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
				sessionSlots: [],
				messages: [],
			};
		}

		const conversationTitle = buildConversationTitle(conversation.title, validatedPayload.prompt);
		const acceptedWrite = buildAcceptedWrite({
			conversation,
			conversationSeed,
			conversationTitle,
			idempotencyKey,
			now: acceptedAt,
			principal: input.principal,
			prompt: validatedPayload.prompt,
			requestFingerprintSha256,
			requestId,
			requestedCapability: validatedPayload.requestedCapability,
			requestedScope: validatedPayload.requestedScope,
			runId,
			versionQuery: validatedPayload.versionQuery,
			safetyIdentifier,
			surface,
			traceId,
			userMessageId,
			outboxEventId: acceptedEventId,
		});

		telemetry?.configureChatRequestScope({
			actor: {
				principalType: input.principal.principal.type,
				subject: input.principal.actor.userId,
			},
			conversationId: conversation.id,
			principalType: input.principal.principal.type,
			requestId,
			requestedCapability: validatedPayload.requestedCapability,
			requestedScope: validatedPayload.requestedScope,
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
			requestedCapability: validatedPayload.requestedCapability,
			requestedScope: validatedPayload.requestedScope,
			safetyIdentifier,
			status: "accepted",
			surface,
			traceId,
		});
		await telemetry?.recordProjectionEnqueued({
			conversationId: conversation.id,
			principalType: input.principal.principal.type,
			projectionStage: "accepted",
			requestId,
			requestedCapability: validatedPayload.requestedCapability,
			requestedScope: validatedPayload.requestedScope,
			safetyIdentifier,
			surface,
			traceId,
		});

		return {
			kind: "accepted",
			value: {
				acceptedAt,
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
				userMessageId,
				validatedPayload,
			},
		};
	}

	async function buildSupervisorInput(
		context: AcceptedChatCommandContext,
	): Promise<SupervisorExecutionInput> {
		const profileMemoryItems = dependencies.profileMemoryStore
			? await dependencies.profileMemoryStore.listProjectionItems({
					ownerUserId: context.input.principal.principal.principalId,
				})
			: [];

		return {
			context: buildSupervisorContextProjection({
				actor: context.input.principal.actor,
				authorization: context.input.principal.authorization,
				profileMemoryItems,
				sessionSlots: context.conversation.sessionSlots,
				turnCount: context.conversation.messages.length,
			}),
			conversationId: context.conversation.id,
			requestId: context.requestId,
			requestedCapability: context.validatedPayload.requestedCapability,
			requestedScope: context.validatedPayload.requestedScope,
			versionQuery: context.validatedPayload.versionQuery,
			safetyIdentifier: context.safetyIdentifier,
			surface: context.surface,
			traceHeaders: telemetry?.getTraceHeaders(),
			traceId: context.traceId,
			userGoal: context.validatedPayload.prompt,
		};
	}

	async function createDurableRunForAcceptedCommand(context: AcceptedChatCommandContext): Promise<{
		response: SupervisorExecutionResponse | null;
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

		const supervisorInput = await buildSupervisorInput(context);
		try {
			const run = await dependencies.executionRuntime.createRun({
				conversationId: context.conversation.id,
				lane: "rag",
				metadata: buildDurableRagRunMetadata(supervisorInput),
				ownerUserId: context.input.principal.actor.userId,
				requestId: context.requestId,
				requestedCapability: context.validatedPayload.requestedCapability,
				runId: context.runId,
				runtimeVersions: {
					contract: "durable-agent-runtime-contract-v1",
				},
				selectedCapability: context.validatedPayload.requestedCapability,
				surface: context.surface,
				traceHeaders: supervisorInput.traceHeaders,
				traceId: context.traceId,
				turnId: context.turnId,
			});
			context.runPhase = runtimeRunPhaseFromSupervisorStatus(run.status);
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
			requestedCapability: input.context.validatedPayload.requestedCapability,
			requestedScope: input.context.validatedPayload.requestedScope,
			safetyIdentifier: input.context.safetyIdentifier,
			retryable: input.transportError.retryable,
			surface: input.context.surface,
			traceId: input.context.traceId,
		});
	}

	async function finalizeAcceptedCommand(input: {
		context: AcceptedChatCommandContext;
		executionResponse: SupervisorExecutionResponse;
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
		const assistantMessageId = generateId("msg");
		const finalEventId = generateId("evt");
		const finalized = buildFinalizedWrite({
			assistantMessageId,
			completedAt,
			conversation: context.conversation,
			conversationTitle: context.conversationTitle,
			durationMs,
			outboxEventId: finalEventId,
			principal: context.input.principal,
			requestId: context.requestId,
			requestedCapability: context.validatedPayload.requestedCapability,
			requestedScope: context.validatedPayload.requestedScope,
			response: input.executionResponse,
			runId: context.runId,
			versionQuery: context.validatedPayload.versionQuery,
			safetyIdentifier: context.safetyIdentifier,
			surface: context.surface,
			startedAt: context.acceptedAt,
			traceId: context.traceId,
		});

		finalized.write.requestExecution.userMessageId = context.userMessageId;
		finalized.write.requestExecution.actorUserId = context.input.principal.actor.userId;
		finalized.write.requestExecution.actorPrincipalId = context.input.principal.actor.principalId;
		finalized.write.requestExecution.actorRoles = context.input.principal.actor.roles;
		finalized.write.requestExecution.actorDepartments = context.input.principal.actor.departments;
		finalized.write.requestExecution.principalType = context.input.principal.principal.type;
		finalized.write.requestExecution.principalLabel = context.input.principal.principal.displayName;
		finalized.write.requestExecution.entitlementSnapshotId =
			context.input.principal.authorization?.entitlementSnapshotId || null;
		finalized.write.requestExecution.entitlementGroups =
			context.input.principal.authorization?.entitlementGroups ?? [];
		finalized.write.requestExecution.visibilityScope =
			context.input.principal.authorization?.visibilityScope ?? null;
		finalized.write.requestExecution.applicabilityScope =
			context.input.principal.authorization?.applicabilityScope ?? null;
		finalized.write.requestExecution.idempotencyKey = context.idempotencyKey;
		finalized.write.requestExecution.requestFingerprintSha256 = context.requestFingerprintSha256;
		finalized.write.requestExecution.questionPreview = previewText(context.validatedPayload.prompt);
		finalized.write.requestExecution.requestedCapability =
			context.validatedPayload.requestedCapability;
		finalized.write.requestExecution.requestedScope = context.validatedPayload.requestedScope;
		finalized.write.requestExecution.versionQuery = context.validatedPayload.versionQuery;

		const finalizedConversation = await dependencies.store.finalizeRequest(finalized.write);
		await recordTraceBacklink({
			errorCode: finalized.write.requestExecution.errorCode,
			requestId: context.requestId,
			selectedTarget: finalized.write.requestExecution.selectedTarget,
			status: finalized.write.requestExecution.status,
			surface: context.surface,
			traceId: finalized.write.requestExecution.traceId,
			waitUntil: context.input.waitUntil,
		});
		await telemetry?.recordProjectionEnqueued({
			conversationId: context.conversation.id,
			principalType: context.input.principal.principal.type,
			projectionStage: "finalized",
			requestId: context.requestId,
			requestedCapability: context.validatedPayload.requestedCapability,
			requestedScope: context.validatedPayload.requestedScope,
			resolvedScope: finalized.write.requestExecution.resolvedScope,
			safetyIdentifier: context.safetyIdentifier,
			surface: context.surface,
			traceId: finalized.write.requestExecution.traceId,
		});
		await telemetry?.recordRequestFinalized({
			conversationId: context.conversation.id,
			durationMs,
			errorCode: finalized.write.requestExecution.errorCode,
			principalType: context.input.principal.principal.type,
			requestId: context.requestId,
			requestedCapability: context.validatedPayload.requestedCapability,
			requestedScope: context.validatedPayload.requestedScope,
			resolvedScope: finalized.write.requestExecution.resolvedScope,
			retryable: finalized.write.assistantMessage.retryable,
			safetyIdentifier: context.safetyIdentifier,
			selectedTarget: finalized.write.requestExecution.selectedTarget,
			sourceDocIds: finalized.write.requestExecution.sourceDocIds,
			status: finalized.write.requestExecution.status as
				| "completed"
				| "error"
				| "needs_clarification"
				| "no_answer"
				| "approval_required"
				| "rejected"
				| "cancelled",
			surface: context.surface,
			traceId: finalized.write.requestExecution.traceId,
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
		response: SupervisorExecutionResponse;
		transportError: { code: string; retryable: boolean } | null;
	}> {
		try {
			return await waitForDurableFinalizationResponse({
				context: input.context,
				listRunEvents: (afterSequence) =>
					input.executionRuntime.listRunEvents({
						afterSequence,
						runId: input.context.runId ?? "",
						traceHeaders: telemetry?.getTraceHeaders(),
						traceId: input.context.traceId,
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
	): Promise<SupervisorExecutionResponse | null> {
		const abuseControlState = await getAbuseControlState(context);
		if (abuseControlState?.shouldThrottle) {
			return buildAbuseThrottleRejectedResponse({
				traceId: context.traceId,
			});
		}
		return null;
	}

	return {
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
					listRunEvents: (afterSequence) =>
						executionRuntime.listRunEvents({
							afterSequence,
							runId: context.runId ?? "",
							traceHeaders: telemetry?.getTraceHeaders(),
							traceId: context.traceId,
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
