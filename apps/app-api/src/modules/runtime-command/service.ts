import type { ToolExecutionResponse } from "../integration";
import { ensureLangfuseTraceParent } from "../telemetry/trace";
import { dispatchPendingChatAdmissions } from "./admission-dispatcher";
import { acceptChatCommand } from "./service/acceptance";
import { createChatCommandServiceContext } from "./service/context";
import {
	startDurableFinalizationCloseout,
	waitForDurableFinalizationResponse,
} from "./service/durable";
import { createDurableRunForAcceptedCommand } from "./service/durable-admission";
import {
	buildAbuseThrottleRejectedResponse,
	createPreAcceptError,
	toHandledErrorTransportOutcome,
} from "./service/errors";
import {
	admissionFailureFinalizationFingerprint,
	applyProductFinalization,
	finalizeAcceptedCommand,
	finalizeAdmissionFailure,
	finalizeLocalCancellation,
	readProductFinalizedCommand,
} from "./service/finalization";
import { toTerminalChatStreamEvent } from "./service/stream";
import type {
	AcceptedChatCommandContext,
	ChatCommandResponse,
	ChatCommandService,
	ChatCommandServiceDependencies,
	ChatCommandStreamEvent,
} from "./service/types";

export { deriveSafetyIdentifier, deriveSafetyIdentifierForUser } from "./service/normalize";
export type {
	ChatCommandPayload,
	ChatCommandResponse,
	ChatCommandResult,
	ChatCommandService,
	ChatCommandServiceDependencies,
	ChatCommandStreamEvent,
} from "./service/types";

export function buildChatCommandService(
	dependencies: ChatCommandServiceDependencies,
): ChatCommandService {
	const service = createChatCommandServiceContext(dependencies);
	const { now } = service;

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

	function terminalStreamEventForExisting(response: ChatCommandResponse): ChatCommandStreamEvent {
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
		const abuseControlState = context.safetyIdentifier
			? await dependencies.commandStore.getAbuseControlState({
					now: context.acceptedAt,
					safetyIdentifier: context.safetyIdentifier,
					surface: context.surface,
				})
			: null;
		if (abuseControlState?.shouldThrottle) {
			return buildAbuseThrottleRejectedResponse({
				traceId: context.traceId,
			});
		}
		return null;
	}

	return {
		async readExecutionInput(runId) {
			return dependencies.commandStore.readExecutionInput(runId);
		},
		async dispatchPendingAdmissions() {
			if (!dependencies.executionRuntime) {
				return { admitted: 0, failed: 0, processed: 0 };
			}
			return dispatchPendingChatAdmissions({
				executionRuntime: dependencies.executionRuntime,
				finalizeAdmissionFailure: (input) => finalizeAdmissionFailure(service, input),
				store: dependencies.admissionStore,
			});
		},
		async finalizeLocalCancellation(input) {
			return finalizeLocalCancellation(service, input);
		},
		async applyProductFinalization(input) {
			return applyProductFinalization(service, input);
		},
		async submit(input) {
			const accepted = await acceptChatCommand(service, input);
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
					await finalizeAcceptedCommand(service, {
						context: accepted.value,
						executionResponse: throttleResponse,
					})
				).response;
			}
			const durableRunCreate = await createDurableRunForAcceptedCommand(service, accepted.value);
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
					await finalizeAcceptedCommand(service, {
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
				return readProductFinalizedCommand(service, {
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
			const accepted = await acceptChatCommand(service, input);
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
				const finalized = await finalizeAcceptedCommand(service, {
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
				const durableRunCreate = await createDurableRunForAcceptedCommand(service, context);
				if (durableRunCreate.pendingAdmission) {
					yield acceptedStreamEvent(context);
					return;
				}
				if (durableRunCreate.response) {
					const finalized = await finalizeAcceptedCommand(service, {
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
						readProductFinalizedCommand(service, {
							context: closeoutContext,
							executionResponse,
						}),
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
						dependencies.observabilityStore.recordStreamAppApiTtft({
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
