import { ExecutionControlTransportError, type ToolExecutionResponse } from "../../integration";
import { runtimeRunPhaseFromExecutionStatus } from "../../runtime-run";
import {
	assertExecutionRunMatchesAdmission,
	buildAdmissionRunQuery,
	executionRunAdmissionTimestamp,
	isRecoverableAdmissionCreateError,
	readFrozenChatAdmission,
} from "../admission-dispatcher";
import type { ChatCommandServiceContext } from "./context";
import { toHandledErrorTransportOutcome } from "./errors";
import type { AcceptedChatCommandContext } from "./types";

export interface DurableRunCreateResult {
	admissionFailure: { workflowId: string } | null;
	pendingAdmission: boolean;
	response: ToolExecutionResponse | null;
	transportError: { code: string; retryable: boolean } | null;
}

export async function createDurableRunForAcceptedCommand(
	service: ChatCommandServiceContext,
	context: AcceptedChatCommandContext,
): Promise<DurableRunCreateResult> {
	const { dependencies, now } = service;
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
			const dispatch = await dependencies.commandStore.readExecutionInput(context.runId ?? "");
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
		const claimed = await dependencies.admissionStore.claimAdmission({
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
				await dependencies.admissionStore.releaseAdmission({
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
				// The create response is unconfirmed. Release the local fence so
				// the admission dispatcher can retry the idempotent request.
				await dependencies.admissionStore.releaseAdmission({
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
			markedAdmitted = await dependencies.admissionStore.markAdmitted({
				admittedAt: executionRunAdmissionTimestamp(run),
				requestId: context.requestId,
				workflowId,
			});
		} catch (error) {
			markError = error;
		}
		if (!markedAdmitted) {
			// The run create is idempotent. Re-read it and retry the app-api
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
					markedAdmitted = await dependencies.admissionStore.markAdmitted({
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
			await dependencies.admissionStore.releaseAdmission({
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
			// request resumable instead of entering the blocking path with a run
			// whose app-api admission state was never committed.
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
			error instanceof ExecutionControlTransportError && !isRecoverableAdmissionCreateError(error);
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
