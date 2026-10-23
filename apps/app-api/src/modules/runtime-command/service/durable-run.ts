import {
	type AgentControlRun,
	type AgentControlRunCreateInput,
	AgentControlTransportError,
} from "../../integration";
import { TOOL_EXECUTION_CONTRACT } from "../../integration/generated/tool-execution-contract";
import type { AcceptedChatCommandStore } from "../store-types";
import type { ChatCommandServiceContext } from "./context";
import { executionInputRef } from "./durable-metadata";
import { toHandledErrorTransportOutcome } from "./errors";
import type { AcceptedChatCommandContext } from "./types";

const DURABLE_RUNTIME_VERSIONS = {
	contract: "durable-agent-runtime-contract-v1",
} as const;

const MAX_DURABLE_RUN_RECOVERY_ATTEMPTS = 3;

export interface DurableRunEnsureResult {
	response: ReturnType<typeof toHandledErrorTransportOutcome> | null;
	run: AgentControlRun | null;
}

export async function ensureDurableRunForStoredInput(input: {
	commandStore: AcceptedChatCommandStore;
	executionRuntime: NonNullable<ChatCommandServiceContext["dependencies"]["executionRuntime"]>;
	requestId: string;
}): Promise<AgentControlRun> {
	const stored = await input.commandStore.readDurableRunInput(input.requestId);
	if (stored?.status !== "accepted") {
		throw new AgentControlTransportError({
			code: "runtime_invariant_failed",
			message: "Accepted chat request does not have a durable execution record.",
			retryable: false,
			status: 500,
		});
	}
	const createInput = createInputFromStoredRun(stored);
	for (let attempt = 0; attempt < MAX_DURABLE_RUN_RECOVERY_ATTEMPTS; attempt += 1) {
		try {
			const run = await input.executionRuntime.createRun(createInput);
			assertRunMatchesStoredInput(createInput, run);
			return run;
		} catch (error) {
			if (!isAmbiguousCreateFailure(error)) {
				throw error;
			}

			try {
				const run = await input.executionRuntime.getRun({ requestId: stored.requestId });
				assertRunMatchesStoredInput(createInput, run);
				return run;
			} catch (lookupError) {
				if (!isMissingRun(lookupError)) {
					throw lookupError;
				}
			}
		}
	}
	throw durableRunRecoveryPending();
}

function createInputFromStoredRun(input: {
	conversationId: string;
	executionInputJson: string | null;
	executionInputSha256: string | null;
	memoryRecallEnabled: boolean | null;
	ownerUserId: string;
	requestId: string;
	surface: string;
}): AgentControlRunCreateInput {
	// App API hashed this JSON when it froze the input; agent-control verifies it after fetching.
	if (!(input.executionInputJson && input.executionInputSha256)) {
		throw new AgentControlTransportError({
			code: "runtime_invariant_failed",
			message: "Durable execution input is missing.",
			retryable: false,
			status: 500,
		});
	}

	return {
		conversationId: input.conversationId,
		metadata: {
			execution_contract_version: TOOL_EXECUTION_CONTRACT.executionContractVersion,
			execution_input_ref: executionInputRef(input.requestId),
			execution_input_sha256: input.executionInputSha256,
		},
		ownerUserId: input.ownerUserId,
		personalMemoryRecallAllowed: input.memoryRecallEnabled ?? false,
		requestId: input.requestId,
		runtimeVersions: DURABLE_RUNTIME_VERSIONS,
		surface: input.surface,
	};
}

function assertRunMatchesStoredInput(
	input: AgentControlRunCreateInput,
	run: AgentControlRun,
): void {
	if (
		run.requestId !== input.requestId ||
		run.conversationId !== input.conversationId ||
		run.ownerUserId !== input.ownerUserId ||
		run.surface !== input.surface
	) {
		throw new AgentControlTransportError({
			code: "agent_control_invalid_response",
			message: "Execution identity does not match the product request.",
			retryable: true,
			status: 502,
		});
	}
}

function isAmbiguousCreateFailure(error: unknown): boolean {
	return error instanceof AgentControlTransportError && error.retryable && error.status >= 500;
}

function isMissingRun(error: unknown): boolean {
	return (
		error instanceof AgentControlTransportError &&
		error.status === 404 &&
		(error.code === "durable_run_not_found" || error.code === "execution_run_not_found")
	);
}

function durableRunRecoveryPending(): AgentControlTransportError {
	return new AgentControlTransportError({
		code: "execution_status_pending",
		message: "Durable run creation is still pending and can be resumed.",
		retryable: true,
		status: 504,
	});
}

export async function ensureDurableRunForAcceptedCommand(
	service: ChatCommandServiceContext,
	context: AcceptedChatCommandContext,
): Promise<DurableRunEnsureResult> {
	const executionRuntime = service.dependencies.executionRuntime;
	if (!executionRuntime) {
		throw new AgentControlTransportError({
			code: "execution_runtime_required",
			message: "Execution runtime is required for durable chat execution.",
			retryable: true,
			status: 503,
		});
	}

	try {
		const run = await ensureDurableRunForStoredInput({
			commandStore: service.dependencies.commandStore,
			executionRuntime,
			requestId: context.requestId,
		});
		return { response: null, run };
	} catch (error) {
		if (isAmbiguousCreateFailure(error) || isRecoveryPending(error)) {
			throw error;
		}
		return {
			response: toHandledErrorTransportOutcome(error),
			run: null,
		};
	}
}

function isRecoveryPending(error: unknown): error is AgentControlTransportError {
	return error instanceof AgentControlTransportError && error.code === "execution_status_pending";
}
