import { ExecutionControlTransportError, type ToolExecutionResponse } from "../integration";
import { runtimeRunPhaseFromExecutionStatus } from "../runtime-run";
import { acceptChatCommand } from "./service/acceptance";
import { createChatCommandServiceContext } from "./service/context";
import {
	startDurableFinalizationCloseout,
	waitForDurableFinalizationResponse,
} from "./service/durable-polling";
import { ensureDurableRunForAcceptedCommand } from "./service/durable-run";
import {
	buildAbuseThrottleRejectedResponse,
	createPreAcceptError,
	toHandledErrorTransportOutcome,
} from "./service/errors";
import {
	applyProductFinalization,
	finalizeAcceptedCommand,
	readProductFinalizedCommand,
} from "./service/finalization";
import { acceptedCloseoutContext } from "./service/product-finalization";
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
		context: Pick<AcceptedChatCommandContext, "acceptedAt" | "requestId" | "runPhase">,
	): ChatCommandStreamEvent {
		return {
			data: {
				occurredAt: context.acceptedAt,
				requestId: context.requestId,
				...(context.runPhase ? { runPhase: context.runPhase } : {}),
				status: "accepted",
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
	}> {
		try {
			return await waitForDurableFinalizationResponse({
				context: input.context,
				listRunEvents: (afterSequence, waitMs) =>
					input.executionRuntime.listRunEvents({
						afterSequence,
						requestId: input.context.requestId,
						...(waitMs === undefined ? {} : { waitMs }),
					}),
				...(dependencies.durableEventPolling ? { polling: dependencies.durableEventPolling } : {}),
			});
		} catch (error) {
			const handled = toHandledErrorTransportOutcome(error);
			return {
				response: handled,
				terminalObserved: false,
			};
		}
	}

	async function buildThrottleResponseIfNeeded(
		context: AcceptedChatCommandContext,
	): Promise<ToolExecutionResponse | null> {
		if (!dependencies.abuseThrottleEnabled) {
			return null;
		}
		const abuseControlState = context.safetyIdentifier
			? await dependencies.commandStore.getAbuseControlState({
					now: context.acceptedAt,
					safetyIdentifier: context.safetyIdentifier,
					surface: context.surface,
				})
			: null;
		if (abuseControlState?.shouldThrottle) {
			return buildAbuseThrottleRejectedResponse();
		}
		return null;
	}

	async function contextForAcceptedReplay(input: {
		acceptedAt: string;
		requestId: string;
	}): Promise<AcceptedChatCommandContext> {
		const candidate = await dependencies.commandStore.getDurableRequestForCloseout(input.requestId);
		if (!candidate) {
			throw new ExecutionControlTransportError({
				code: "runtime_invariant_failed",
				message: "Accepted chat request could not be reconstructed for retry.",
				retryable: false,
				status: 500,
			});
		}
		return {
			...acceptedCloseoutContext(candidate),
			acceptedAt: input.acceptedAt,
		};
	}

	async function ensureDurableRun(context: AcceptedChatCommandContext) {
		const result = await ensureDurableRunForAcceptedCommand(service, context);
		if (result.run) {
			context.runPhase = runtimeRunPhaseFromExecutionStatus(result.run.status);
		}
		return result;
	}

	return {
		async recordClientTiming(input) {
			if (!dependencies.observabilityStore.recordClientTiming) {
				return false;
			}
			return dependencies.observabilityStore.recordClientTiming({
				...input,
				observedAt: new Date().toISOString(),
			});
		},
		async readExecutionInput(requestId) {
			const stored = await dependencies.commandStore.readDurableRunInput(requestId);
			return stored
				? {
						executionInputJson: stored.executionInputJson,
						executionInputSha256: stored.executionInputSha256,
					}
				: null;
		},
		async applyProductFinalization(input) {
			return applyProductFinalization(service, input);
		},
		async submit(input) {
			const accepted = await acceptChatCommand(service, input);
			if (accepted.kind === "existing") {
				return accepted.response;
			}
			const context =
				accepted.kind === "accepted_replay"
					? await contextForAcceptedReplay(accepted)
					: accepted.value;

			const throttleResponse =
				accepted.kind === "accepted" ? await buildThrottleResponseIfNeeded(context) : null;
			if (throttleResponse) {
				return (
					await finalizeAcceptedCommand(service, {
						context,
						executionResponse: throttleResponse,
					})
				).response;
			}
			const durableRunCreate = await ensureDurableRun(context);
			if (durableRunCreate.response) {
				return (
					await finalizeAcceptedCommand(service, {
						context,
						executionResponse: durableRunCreate.response,
					})
				).response;
			}
			const executionRuntime = dependencies.executionRuntime;
			if (executionRuntime) {
				const execution = await executeDurableBlocking({
					context,
					executionRuntime,
				});
				if (!execution.terminalObserved) {
					throw createPreAcceptError({
						code: "execution_status_pending",
						details: { requestId: context.requestId },
						message: "The request is still running and can be resumed.",
						retryable: true,
						status: 504,
					});
				}
				return readProductFinalizedCommand(service, {
					context,
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
			const context =
				accepted.kind === "accepted_replay"
					? await contextForAcceptedReplay(accepted)
					: accepted.value;
			const throttleResponse =
				accepted.kind === "accepted" ? await buildThrottleResponseIfNeeded(context) : null;
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
				yield acceptedStreamEvent(context);

				let durableRunCreate: Awaited<ReturnType<typeof ensureDurableRun>>;
				try {
					durableRunCreate = await ensureDurableRun(context);
				} catch (error) {
					if (
						error instanceof ExecutionControlTransportError &&
						error.code === "execution_status_pending"
					) {
						return;
					}
					throw error;
				}
				if (durableRunCreate.response) {
					const finalized = await finalizeAcceptedCommand(service, {
						context,
						executionResponse: durableRunCreate.response,
					});
					yield toTerminalChatStreamEvent({
						occurredAt: now().toISOString(),
						response: finalized.response,
					});
					return;
				}

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
							requestId: context.requestId,
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
