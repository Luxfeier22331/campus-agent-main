import {
	type ExecutionControlRun,
	type ExecutionControlRunCreateInput,
	ExecutionControlTransportError,
} from "../../integration";
import { TOOL_EXECUTION_CONTRACT } from "../../integration/generated/tool-execution-contract";
import { ensureLangfuseTraceParent } from "../../telemetry/trace";
import type { AcceptedChatCommandStore } from "../store-types";
import type { ChatCommandServiceContext } from "./context";
import { executionInputRef, sha256Text } from "./durable-metadata";
import { toHandledErrorTransportOutcome } from "./errors";
import type { AcceptedChatCommandContext } from "./types";

const DURABLE_RUNTIME_VERSIONS = {
	contract: "durable-agent-runtime-contract-v1",
} as const;

export interface DurableRunEnsureResult {
	response: ReturnType<typeof toHandledErrorTransportOutcome> | null;
	run: ExecutionControlRun | null;
}

export async function ensureDurableRunForStoredInput(input: {
	commandStore: AcceptedChatCommandStore;
	executionRuntime: NonNullable<ChatCommandServiceContext["dependencies"]["executionRuntime"]>;
	runId: string;
	traceId: string;
}): Promise<ExecutionControlRun> {
	const stored = await input.commandStore.readDurableRunInput(input.runId);
	if (stored?.status !== "accepted") {
		throw new ExecutionControlTransportError({
			code: "runtime_invariant_failed",
			message: "Accepted chat request does not have a durable run record.",
			retryable: false,
			status: 500,
		});
	}
	if (stored.traceId !== input.traceId) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Stored durable run trace identity does not match the request.",
			retryable: false,
			status: 500,
		});
	}
	const createInput = createInputFromStoredRun(stored);
	const traceHeaders = await ensureLangfuseTraceParent(stored.traceId);
	try {
		const run = await input.executionRuntime.createRun({ ...createInput, traceHeaders });
		assertRunMatchesStoredInput(createInput, run);
		return run;
	} catch (error) {
		if (!isAmbiguousCreateFailure(error)) {
			throw error;
		}
		const run = await input.executionRuntime.getRun({
			runId: stored.runId,
			traceHeaders,
			traceId: stored.traceId,
		});
		assertRunMatchesStoredInput(createInput, run);
		return run;
	}
}

function createInputFromStoredRun(input: {
	conversationId: string;
	executionInputJson: string | null;
	executionInputSha256: string | null;
	memoryRecallEnabled: boolean | null;
	ownerUserId: string;
	requestId: string;
	runId: string;
	surface: string;
	traceId: string;
	turnId: string | null;
}): ExecutionControlRunCreateInput {
	if (
		!(input.executionInputJson && input.executionInputSha256 && input.turnId) ||
		sha256Text(input.executionInputJson) !== input.executionInputSha256
	) {
		throw new ExecutionControlTransportError({
			code: "runtime_invariant_failed",
			message: "Durable execution input is missing or failed hash validation.",
			retryable: false,
			status: 500,
		});
	}

	return {
		conversationId: input.conversationId,
		metadata: {
			execution_contract_version: TOOL_EXECUTION_CONTRACT.executionContractVersion,
			execution_input_ref: executionInputRef(input.runId),
			execution_input_sha256: input.executionInputSha256,
		},
		ownerUserId: input.ownerUserId,
		personalMemoryRecallAllowed: input.memoryRecallEnabled ?? false,
		requestId: input.requestId,
		runId: input.runId,
		runtimeVersions: DURABLE_RUNTIME_VERSIONS,
		surface: input.surface,
		traceId: input.traceId,
		turnId: input.turnId,
	};
}

function assertRunMatchesStoredInput(
	input: ExecutionControlRunCreateInput,
	run: ExecutionControlRun,
): void {
	if (
		run.runId !== input.runId ||
		run.requestId !== input.requestId ||
		run.conversationId !== input.conversationId ||
		run.ownerUserId !== input.ownerUserId ||
		run.surface !== input.surface ||
		run.traceId !== (input.traceId ?? "") ||
		run.turnId !== input.turnId
	) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Execution durable run identity does not match the product request.",
			retryable: true,
			status: 502,
		});
	}
}

function isAmbiguousCreateFailure(error: unknown): boolean {
	return error instanceof ExecutionControlTransportError && error.retryable && error.status >= 500;
}

export async function ensureDurableRunForAcceptedCommand(
	service: ChatCommandServiceContext,
	context: AcceptedChatCommandContext,
): Promise<DurableRunEnsureResult> {
	const executionRuntime = service.dependencies.executionRuntime;
	if (!(executionRuntime && context.runId)) {
		throw new ExecutionControlTransportError({
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
			runId: context.runId,
			traceId: context.traceId,
		});
		return { response: null, run };
	} catch (error) {
		if (isAmbiguousCreateFailure(error)) {
			throw error;
		}
		return {
			response: {
				...toHandledErrorTransportOutcome(error),
				traceId: context.traceId,
			},
			run: null,
		};
	}
}
