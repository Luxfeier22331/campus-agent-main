import type { CapabilityExecutionResponse } from "../../integration";
import { ensureLangfuseTraceParent } from "../../telemetry/trace";
import { durableTerminalOutcomeFromDurableRunEvent } from "./durable";
import type {
	AcceptedChatCommandContext,
	ChatCommandResponse,
	ChatCommandService,
	ChatCommandServiceDependencies,
} from "./types";

const DEFAULT_DURABLE_CLOSEOUT_RECONCILE_LIMIT = 10;
const DEFAULT_DURABLE_CLOSEOUT_MIN_AGE_MS = 30_000;

type DurableCloseoutCandidate = Awaited<
	ReturnType<ChatCommandServiceDependencies["store"]["listAcceptedDurableRequestsForCloseout"]>
>[number];

type ReconcileDurableCloseoutsInput = NonNullable<
	Parameters<NonNullable<ChatCommandService["reconcileDurableCloseouts"]>>[0]
>;

function acceptedCloseoutContext(candidate: DurableCloseoutCandidate): AcceptedChatCommandContext {
	return {
		acceptedAt: candidate.acceptedAt,
		branchId: candidate.conversation.activeBranchId ?? "branch_active",
		conversation: candidate.conversation,
		conversationTitle: candidate.conversationTitle,
		idempotencyKey: candidate.idempotencyKey,
		input: {
			payload: {
				conversationId: candidate.conversation.id,
				prompt: candidate.questionPreview,
				requestedCapability: candidate.requestedCapability,
				requestedScope: candidate.requestedScope,
				versionQuery: candidate.versionQuery,
			},
			principal: candidate.principal,
			surface: candidate.surface,
		},
		requestFingerprintSha256: candidate.requestFingerprintSha256,
		requestId: candidate.requestId,
		runId: candidate.runId,
		runPhase: null,
		safetyIdentifier: candidate.safetyIdentifier,
		surface: candidate.surface,
		traceId: candidate.traceId,
		turnId: null,
		turnSequence: candidate.turnSequence,
		userMessageId: candidate.userMessageId,
		validatedPayload: {
			conversationId: candidate.conversation.id,
			prompt: candidate.questionPreview,
			requestedCapability: candidate.requestedCapability,
			requestedScope: candidate.requestedScope,
			versionQuery: candidate.versionQuery,
		},
	};
}

async function reconcileOneDurableCloseout(input: {
	candidate: DurableCloseoutCandidate;
	dependencies: ChatCommandServiceDependencies;
	finalizeAcceptedCommand(finalizeInput: {
		context: AcceptedChatCommandContext;
		executionResponse: CapabilityExecutionResponse;
		transportError?: { code: string; retryable: boolean } | null;
	}): Promise<ChatCommandResponse>;
}): Promise<boolean> {
	const { candidate, dependencies, finalizeAcceptedCommand } = input;
	if (!dependencies.executionRuntime) {
		return false;
	}
	const context = acceptedCloseoutContext(candidate);
	const runEvents = await dependencies.executionRuntime.listRunEvents({
		afterSequence: 0,
		runId: candidate.runId,
		traceHeaders: ensureLangfuseTraceParent(
			dependencies.telemetry?.getTraceHeaders(),
			candidate.traceId,
		),
		traceId: candidate.traceId,
		waitMs: 0,
	});
	for (const runEvent of runEvents) {
		const terminalOutcome = durableTerminalOutcomeFromDurableRunEvent(context, runEvent);
		if (!terminalOutcome) {
			continue;
		}
		await finalizeAcceptedCommand({
			context,
			executionResponse: terminalOutcome.response,
			transportError: terminalOutcome.transportError,
		});
		return true;
	}
	return false;
}

export async function reconcileDurableCloseouts(input: {
	dependencies: ChatCommandServiceDependencies;
	finalizeAcceptedCommand(finalizeInput: {
		context: AcceptedChatCommandContext;
		executionResponse: CapabilityExecutionResponse;
		transportError?: { code: string; retryable: boolean } | null;
	}): Promise<ChatCommandResponse>;
	now: () => Date;
	reconcileInput?: ReconcileDurableCloseoutsInput;
}): Promise<{ failed: number; finalized: number; scanned: number }> {
	const { dependencies, finalizeAcceptedCommand, now } = input;
	if (!dependencies.executionRuntime) {
		return { failed: 0, finalized: 0, scanned: 0 };
	}
	const startedBefore =
		input.reconcileInput?.startedBefore ??
		new Date(now().valueOf() - DEFAULT_DURABLE_CLOSEOUT_MIN_AGE_MS).toISOString();
	const candidates = await dependencies.store.listAcceptedDurableRequestsForCloseout({
		limit: input.reconcileInput?.limit ?? DEFAULT_DURABLE_CLOSEOUT_RECONCILE_LIMIT,
		runId: input.reconcileInput?.runId,
		startedBefore,
	});
	let failed = 0;
	let finalized = 0;
	for (const candidate of candidates) {
		try {
			if (
				await reconcileOneDurableCloseout({
					candidate,
					dependencies,
					finalizeAcceptedCommand,
				})
			) {
				finalized += 1;
			}
		} catch (error) {
			failed += 1;
			dependencies.telemetry?.captureException(error, {
				route: "app-api.durable-closeout.reconcile",
				surface: candidate.surface,
				traceId: candidate.traceId,
			});
			console.error(
				JSON.stringify({
					error:
						error instanceof Error
							? {
									message: error.message,
									name: error.name,
								}
							: {
									message: String(error),
									name: "UnknownError",
								},
					requestId: candidate.requestId,
					runId: candidate.runId,
					source: "app-api.durable-closeout.reconcile",
				}),
			);
		}
	}
	return { failed, finalized, scanned: candidates.length };
}
