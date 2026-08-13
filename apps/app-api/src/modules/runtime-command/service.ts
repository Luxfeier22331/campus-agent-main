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
	assertExecutionRunMatchesAdmission,
	buildAdmissionRunQuery,
	type ChatAdmissionFailureFinalization,
	dispatchPendingChatAdmissions,
	executionRunAdmissionTimestamp,
	isRecoverableAdmissionCreateError,
	readFrozenChatAdmission,
} from "./admission-dispatcher";
import {
	startDurableFinalizationCloseout,
	waitForDurableFinalizationResponse,
} from "./service/durable";
import { freezeToolExecutionRunInput, sha256Text } from "./service/durable-metadata";
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
import { executionFinalizationErrorResponse, toTerminalChatStreamEvent } from "./service/stream";
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
import {
	type AcceptedDurableRequestCloseout,
	ChatAcceptanceConversationConflict,
	ChatAcceptanceIdempotencyConflict,
	ChatFinalizationConflict,
} from "./store-types";

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
	| {
			acceptedAt: string;
			kind: "accepted_replay";
			requestId: string;
			runId: string;
			traceId: string;
	  }
	| { kind: "existing"; response: import("./service/types").ChatCommandResponse };

function admissionFailureFinalizationFingerprint(input: {
	errorCode: string;
	runId: string;
	workflowId: string;
}): string {
	return sha256Text(`${input.runId}\0admission_failed\0${input.workflowId}\0${input.errorCode}`);
}

function isExactFinalizationReplay(
	candidate: AcceptedDurableRequestCloseout,
	input: { completedAt: string; finalizationFingerprint: string },
): boolean {
	if (!(candidate.finalizationFingerprint || candidate.completedAt)) {
		return false;
	}
	const recordedCompletedAt = candidate.completedAt
		? new Date(candidate.completedAt).valueOf()
		: Number.NaN;
	const requestedCompletedAt = new Date(input.completedAt).valueOf();
	if (
		!(
			candidate.finalizationFingerprint &&
			Number.isFinite(recordedCompletedAt) &&
			Number.isFinite(requestedCompletedAt)
		) ||
		candidate.finalizationFingerprint !== input.finalizationFingerprint ||
		recordedCompletedAt !== requestedCompletedAt
	) {
		throw new ChatFinalizationConflict();
	}
	return true;
}

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
		const requestFingerprintSha256 = idempotencyKey
			? computeFingerprint({
					conversationDiscriminator,
					prompt: validatedPayload.prompt,
				})
			: null;
		const resolveIdempotentRequest = (
			existing: NonNullable<Awaited<ReturnType<typeof dependencies.store.findIdempotentRequest>>>,
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
			const existing = await dependencies.store.findIdempotentRequest({
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
		const workflowId = `campus-agent.chat.${runId}`;
		const acceptedWrite = buildAcceptedWrite({
			assistantMessageId,
			captureMemorySnapshot: dependencies.profileMemoryStore !== undefined,
			branchId,
			conversation,
			...(conversationSeed ? { conversationSeed } : {}),
			conversationTitle,
			freezeDurableAdmission(memorySnapshot) {
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
				const admissionInput = {
					conversationId: conversation.id,
					metadata: { ...frozenInput.metadata },
					ownerUserId: input.principal.actor.userId,
					personalMemoryRecallAllowed: memorySnapshot?.recallEnabled ?? false,
					requestId,
					runId,
					runtimeVersions: {
						contract: "durable-agent-runtime-contract-v1",
					},
					surface,
					traceHeaders,
					traceId,
					turnId,
				};
				const admissionInputJson = JSON.stringify(admissionInput);
				return {
					admissionInputJson,
					admissionInputSha256: sha256Text(admissionInputJson),
					executionInputJson: frozenInput.executionInputJson,
					executionInputSha256: frozenInput.executionInputSha256,
					workflowId,
				};
			},
			idempotencyKey,
			now: acceptedAt,
			principal: input.principal,
			prompt: validatedPayload.prompt,
			requestFingerprintSha256,
			requestId,
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
			safetyIdentifier,
			surface,
			traceId,
		});

		let acceptedState: Awaited<ReturnType<typeof dependencies.store.acceptRequest>>;
		try {
			acceptedState = await dependencies.store.acceptRequest(acceptedWrite);
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
				const existing = await dependencies.store.findIdempotentRequest({
					actorUserId: input.principal.actor.userId,
					idempotencyKey,
				});
				if (existing) {
					return resolveIdempotentRequest(existing);
				}
			}
			throw error;
		}

		await telemetry?.recordRequestAccepted({
			actor: {
				principalType: input.principal.principal.type,
				subject: input.principal.actor.userId,
			},
			conversationId: conversation.id,
			principalType: input.principal.principal.type,
			requestId,
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
				frozenAdmission: acceptedState.frozenAdmission,
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

	async function createDurableRunForAcceptedCommand(context: AcceptedChatCommandContext): Promise<{
		admissionFailure: { workflowId: string } | null;
		pendingAdmission: boolean;
		response: ToolExecutionResponse | null;
		transportError: { code: string; retryable: boolean } | null;
	}> {
		if (!dependencies.executionRuntime) {
			return {
				admissionFailure: null,
				pendingAdmission: false,
				response: null,
				transportError: null,
			};
		}
		if (!(context.runId && context.turnId && context.frozenAdmission)) {
			throw new ExecutionControlTransportError({
				code: "runtime_invariant_failed",
				message: "Execution runtime command is missing run or turn id.",
				retryable: false,
				status: 500,
			});
		}

		const workflowId = context.frozenAdmission.workflowId;
		const productRequestReachedTerminalStatus = async (): Promise<boolean> => {
			try {
				const dispatch = await dependencies.store.readExecutionInput(context.runId ?? "");
				return (
					dispatch?.requestId === context.requestId &&
					dispatch.runId === context.runId &&
					dispatch.status !== "accepted"
				);
			} catch {
				return false;
			}
		};
		let deterministicFailure = false;
		try {
			const claimed = await dependencies.store.claimAdmission({
				requestId: context.requestId,
				updatedAt: now().toISOString(),
				workflowId,
			});
			if (!claimed) {
				throw new ExecutionControlTransportError({
					code: "admission_pending",
					message: "Chat admission dispatch was superseded before execution started.",
					retryable: true,
					status: 503,
				});
			}
			let admissionInput: ReturnType<typeof readFrozenChatAdmission>;
			try {
				admissionInput = readFrozenChatAdmission({
					admissionInputJson: context.frozenAdmission.admissionInputJson,
					admissionInputSha256: context.frozenAdmission.admissionInputSha256,
					requestId: context.requestId,
					runId: context.runId,
					workflowId,
				});
			} catch (error) {
				deterministicFailure = true;
				throw error;
			}
			let run: Awaited<ReturnType<NonNullable<typeof dependencies.executionRuntime>["createRun"]>>;
			try {
				run = await dependencies.executionRuntime.createRun(admissionInput);
			} catch (error) {
				if (
					error instanceof ExecutionControlTransportError &&
					!isRecoverableAdmissionCreateError(error)
				) {
					deterministicFailure = true;
					throw error;
				}
				if (!isRecoverableAdmissionCreateError(error)) {
					await dependencies.store.releaseAdmission({
						requestId: context.requestId,
						updatedAt: now().toISOString(),
						workflowId,
					});
					throw error;
				}
				try {
					run = await dependencies.executionRuntime.getRun(buildAdmissionRunQuery(admissionInput));
					assertExecutionRunMatchesAdmission(admissionInput, run);
				} catch (recoveryError) {
					if (
						recoveryError instanceof ExecutionControlTransportError &&
						recoveryError.code === "admission_identity_conflict"
					) {
						deterministicFailure = true;
						throw recoveryError;
					}
					// The create response is unconfirmed.  Release the local fence so
					// the admission dispatcher can retry the idempotent request.
					await dependencies.store.releaseAdmission({
						requestId: context.requestId,
						updatedAt: now().toISOString(),
						workflowId,
					});
					throw error;
				}
			}
			try {
				assertExecutionRunMatchesAdmission(admissionInput, run);
			} catch (error) {
				deterministicFailure = true;
				throw error;
			}
			let markError: unknown = null;
			let markedAdmitted = false;
			try {
				markedAdmitted = await dependencies.store.markAdmitted({
					admittedAt: executionRunAdmissionTimestamp(run),
					requestId: context.requestId,
					workflowId,
				});
			} catch (error) {
				markError = error;
			}
			if (!markedAdmitted) {
				// The run create is idempotent.  Re-read it and retry the app-api
				// fence once before exposing a resumable pending state.
				let recoveredRun: typeof run | null = null;
				try {
					recoveredRun = await dependencies.executionRuntime.getRun(
						buildAdmissionRunQuery(admissionInput),
					);
					assertExecutionRunMatchesAdmission(admissionInput, recoveredRun);
				} catch (recoveryError) {
					if (
						recoveryError instanceof ExecutionControlTransportError &&
						recoveryError.code === "admission_identity_conflict"
					) {
						deterministicFailure = true;
						throw recoveryError;
					}
					markError = recoveryError;
					recoveredRun = null;
				}
				if (recoveredRun) {
					try {
						markedAdmitted = await dependencies.store.markAdmitted({
							admittedAt: executionRunAdmissionTimestamp(recoveredRun),
							requestId: context.requestId,
							workflowId,
						});
					} catch (error) {
						markError = error;
					}
					if (markedAdmitted) {
						run = recoveredRun;
					}
				}
			}
			if (!markedAdmitted) {
				if (await productRequestReachedTerminalStatus()) {
					context.runPhase = runtimeRunPhaseFromExecutionStatus(run.status);
					return {
						admissionFailure: null,
						pendingAdmission: false,
						response: null,
						transportError: null,
					};
				}
				await dependencies.store.releaseAdmission({
					requestId: context.requestId,
					updatedAt: now().toISOString(),
					workflowId,
				});
				if (markError) {
					throw new ExecutionControlTransportError({
						code: "admission_confirmation_uncertain",
						message: "Execution admission confirmation could not be committed.",
						retryable: true,
						status: 503,
					});
				}
				// Cancellation or another dispatcher won the admission fence after
				// execution-control accepted the idempotent run. Keep the accepted
				// request resumable instead of entering the blocking path with a
				// run whose app-api admission state was never committed.
				throw new ExecutionControlTransportError({
					code: "admission_pending",
					message: "Execution admission was superseded before app-api confirmation.",
					retryable: true,
					status: 503,
				});
			}
			context.runPhase = runtimeRunPhaseFromExecutionStatus(run.status);
			return {
				admissionFailure: null,
				pendingAdmission: false,
				response: null,
				transportError: null,
			};
		} catch (error) {
			const handled = toHandledErrorTransportOutcome(error);
			const permanentTransportFailure =
				error instanceof ExecutionControlTransportError &&
				!isRecoverableAdmissionCreateError(error);
			const admissionFailure = deterministicFailure || permanentTransportFailure;
			return {
				admissionFailure: admissionFailure ? { workflowId } : null,
				pendingAdmission: !admissionFailure,
				response: admissionFailure
					? {
							...handled,
							error: { ...handled.error, retryable: false },
							traceId: context.traceId,
						}
					: null,
				transportError: {
					code: handled.error.code,
					retryable: admissionFailure ? false : handled.error.retryable,
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
			safetyIdentifier: input.context.safetyIdentifier,
			retryable: input.transportError.retryable,
			surface: input.context.surface,
			traceId: input.context.traceId,
		});
	}

	async function finalizeAcceptedCommand(input: {
		admissionFailureWorkflowId?: string;
		completedAt?: string;
		context: AcceptedChatCommandContext;
		executionResponse: ToolExecutionResponse;
		executionFinalizationReceivedAt?: string | null;
		finalizationFingerprint?: string;
		streamAppApiTtftMs?: number | null;
		transportError?: { code: string; retryable: boolean } | null;
	}) {
		const { context } = input;
		const completedAt = input.completedAt ?? now().toISOString();
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
		const appApiStageTiming = await dependencies.store.readRequestStageTiming(context.requestId);
		const finalized = buildFinalizedWrite({
			...(dependencies.publicNoticeURLAllowlist
				? { allowedPublicNoticeHosts: dependencies.publicNoticeURLAllowlist }
				: {}),
			assistantMessageId: context.assistantMessageId,
			branchId: context.branchId,
			completedAt,
			conversation: context.conversation,
			conversationTitle: context.conversationTitle,
			durationMs,
			principal: context.input.principal,
			projectionCloseoutMs,
			requestId: context.requestId,
			response: input.executionResponse,
			runId: context.runId,
			safetyIdentifier: context.safetyIdentifier,
			...(appApiStageTiming === undefined ? {} : { stageTiming: appApiStageTiming }),
			surface: context.surface,
			startedAt: context.acceptedAt,
			...(input.streamAppApiTtftMs === undefined
				? {}
				: { streamAppApiTtftMs: input.streamAppApiTtftMs }),
			traceId: context.traceId,
			turnSequence: context.turnSequence,
			userMessageId: context.userMessageId,
		});
		if (input.finalizationFingerprint) {
			finalized.write.finalizationFingerprint = input.finalizationFingerprint;
		}
		if (input.admissionFailureWorkflowId) {
			finalized.write.admissionFailure = {
				workflowId: input.admissionFailureWorkflowId,
			};
		}

		const result = await dependencies.store.finalizeRequest(finalized.write);
		if (result.outcome === "applied") {
			await recordTransportError({
				context,
				transportError: input.transportError ?? null,
			});
			const stageTiming = finalized.write.requestObservabilityFact.stageTiming;
			await telemetry?.recordRequestFinalized({
				conversationId: context.conversation.id,
				durationMs,
				errorCode: finalized.write.turnDispatch.errorCode,
				modelUsage: input.executionResponse.modelUsage,
				principalType: context.input.principal.principal.type,
				requestId: context.requestId,
				retryable: finalized.write.assistantMessage.retryable,
				safetyIdentifier: context.safetyIdentifier,
				sourceDocIds: extractSourceDocIds(input.executionResponse.result),
				...(stageTiming === undefined ? {} : { stageTiming }),
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
		}

		return {
			outcome: result.outcome,
			response: {
				...finalized.responseBody,
				answer: {
					conversation: toConversationResponse(result.conversation),
					result: finalized.responseBody.answer.result,
				},
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
			...(dependencies.publicNoticeURLAllowlist
				? { allowedPublicNoticeHosts: dependencies.publicNoticeURLAllowlist }
				: {}),
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

	function acceptedStreamEvent(
		context: Pick<
			AcceptedChatCommandContext,
			"acceptedAt" | "requestId" | "runId" | "runPhase" | "traceId"
		>,
	): ChatCommandStreamEvent {
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
						...(waitMs === undefined ? {} : { waitMs }),
					}),
				...(dependencies.durableEventPolling ? { polling: dependencies.durableEventPolling } : {}),
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

	async function finalizeAdmissionFailure(input: ChatAdmissionFailureFinalization): Promise<void> {
		const candidates = await dependencies.store.listAcceptedDurableRequestsForCloseout({
			limit: 1,
			runId: input.runId,
		});
		const candidate = candidates[0];
		if (
			!candidate ||
			candidate.requestId !== input.requestId ||
			candidate.runId !== input.runId ||
			input.workflowId !== `campus-agent.chat.${input.runId}`
		) {
			throw new ChatFinalizationConflict();
		}
		const response = executionFinalizationErrorResponse({
			code: input.errorCode,
			message: "The request could not be admitted for durable execution.",
			retryable: false,
			traceId: candidate.traceId,
		});
		const finalizationFingerprint = admissionFailureFinalizationFingerprint(input);
		if (candidate.finalizationFingerprint || candidate.completedAt) {
			isExactFinalizationReplay(candidate, {
				completedAt: candidate.completedAt ?? "",
				finalizationFingerprint,
			});
			return;
		}
		await finalizeAcceptedCommand({
			admissionFailureWorkflowId: input.workflowId,
			completedAt: now().toISOString(),
			context: acceptedCloseoutContext(candidate),
			executionResponse: response,
			finalizationFingerprint,
			transportError: { code: input.errorCode, retryable: false },
		});
	}

	return {
		async readExecutionInput(runId) {
			return dependencies.store.readExecutionInput(runId);
		},
		async dispatchPendingAdmissions() {
			if (!dependencies.executionRuntime) {
				return { admitted: 0, failed: 0, processed: 0 };
			}
			return dispatchPendingChatAdmissions({
				executionRuntime: dependencies.executionRuntime,
				finalizeAdmissionFailure,
				store: dependencies.store,
			});
		},
		async finalizeLocalCancellation(input) {
			const candidates = await dependencies.store.listAcceptedDurableRequestsForCloseout({
				limit: 1,
				runId: input.runId,
				startedBefore: input.completedAt,
			});
			const candidate = candidates[0];
			if (!candidate) {
				throw createPreAcceptError({
					code: "request_not_found",
					message: "Accepted chat request was not found for local cancellation.",
					status: 404,
				});
			}
			const response = executionFinalizationErrorResponse({
				code: "execution_cancelled",
				message: "The request was cancelled.",
				retryable: false,
				status: "cancelled",
				traceId: candidate.traceId,
			});
			const finalizationFingerprint = sha256Text(`${candidate.runId}\0${JSON.stringify(response)}`);
			if (
				isExactFinalizationReplay(candidate, {
					completedAt: input.completedAt,
					finalizationFingerprint,
				})
			) {
				return { outcome: "replayed" };
			}
			const finalized = await finalizeAcceptedCommand({
				completedAt: input.completedAt,
				context: acceptedCloseoutContext(candidate),
				executionResponse: response,
				finalizationFingerprint,
			});
			return { outcome: finalized.outcome };
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
			if (input.response.traceId !== candidate.traceId) {
				throw new ChatFinalizationConflict();
			}
			if (isExactFinalizationReplay(candidate, input)) {
				return { outcome: "replayed" };
			}
			const finalized = await finalizeAcceptedCommand({
				completedAt: input.completedAt,
				context: acceptedCloseoutContext(candidate),
				executionResponse: input.response,
				finalizationFingerprint: input.finalizationFingerprint,
			});
			return { outcome: finalized.outcome };
		},
		async submit(input) {
			const accepted = await acceptCommand(input);
			if (accepted.kind === "existing") {
				return accepted.response;
			}
			if (accepted.kind === "accepted_replay") {
				throw createPreAcceptError({
					code: "request_in_progress",
					details: { requestId: accepted.requestId, runId: accepted.runId },
					message: "A matching request is still in progress.",
					retryable: true,
					status: 409,
				});
			}

			const throttleResponse = await buildThrottleResponseIfNeeded(accepted.value);
			if (throttleResponse) {
				return (
					await finalizeAcceptedCommand({
						context: accepted.value,
						executionResponse: throttleResponse,
					})
				).response;
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
				return (
					await finalizeAcceptedCommand({
						...(durableRunCreate.admissionFailure
							? {
									admissionFailureWorkflowId: durableRunCreate.admissionFailure.workflowId,
									finalizationFingerprint: admissionFailureFinalizationFingerprint({
										errorCode: durableRunCreate.transportError?.code ?? "internal_error",
										runId: accepted.value.runId ?? "",
										workflowId: durableRunCreate.admissionFailure.workflowId,
									}),
								}
							: {}),
						context: accepted.value,
						executionResponse: durableRunCreate.response,
						transportError: durableRunCreate.transportError,
					})
				).response;
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
			if (accepted.kind === "accepted_replay") {
				yield acceptedStreamEvent({
					...accepted,
					runPhase: null,
				});
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
					response: finalized.response,
				});
				return;
			}

			const executionRuntime = dependencies.executionRuntime;
			if (executionRuntime) {
				const durableRunCreate = await createDurableRunForAcceptedCommand(context);
				if (durableRunCreate.pendingAdmission) {
					yield acceptedStreamEvent(context);
					return;
				}
				if (durableRunCreate.response) {
					const finalized = await finalizeAcceptedCommand({
						...(durableRunCreate.admissionFailure
							? {
									admissionFailureWorkflowId: durableRunCreate.admissionFailure.workflowId,
									finalizationFingerprint: admissionFailureFinalizationFingerprint({
										errorCode: durableRunCreate.transportError?.code ?? "internal_error",
										runId: context.runId ?? "",
										workflowId: durableRunCreate.admissionFailure.workflowId,
									}),
								}
							: {}),
						context,
						executionResponse: durableRunCreate.response,
						transportError: durableRunCreate.transportError,
					});
					yield toTerminalChatStreamEvent({
						occurredAt: now().toISOString(),
						response: finalized.response,
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
							...(waitMs === undefined ? {} : { waitMs }),
						}),
					now,
					...(dependencies.durableEventPolling
						? { polling: dependencies.durableEventPolling }
						: {}),
					recordStreamAppApiTtft: ({ durationMs, observedAt }) =>
						dependencies.store.recordStreamAppApiTtft({
							durationMs,
							observedAt,
							requestId: context.requestId,
						}),
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
