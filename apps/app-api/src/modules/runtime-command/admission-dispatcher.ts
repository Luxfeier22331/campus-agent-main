import { createHash } from "node:crypto";

import {
	type ExecutionControlRun,
	type ExecutionControlRunCreateInput,
	type ExecutionControlRunQuery,
	type ExecutionControlRuntimeClient,
	ExecutionControlTransportError,
} from "../integration";
import type { ChatCommandStore, PendingChatAdmission } from "./store-types";

export interface ChatAdmissionDispatchResult {
	admitted: number;
	failed: number;
	processed: number;
}

export interface ChatAdmissionFailureFinalization {
	errorCode: string;
	requestId: string;
	runId: string;
	workflowId: string;
}

type AdmissionIdentityInput = Pick<
	ExecutionControlRunCreateInput,
	"conversationId" | "ownerUserId" | "requestId" | "runId" | "surface" | "traceId" | "turnId"
>;

type AdmissionIdentityRun = Pick<
	ExecutionControlRun,
	"conversationId" | "ownerUserId" | "requestId" | "runId" | "surface" | "traceId" | "turnId"
>;

type AdmissionRunQueryInput = Pick<
	ExecutionControlRunCreateInput,
	"runId" | "traceHeaders" | "traceId"
>;

export function buildAdmissionRunQuery(input: AdmissionRunQueryInput): ExecutionControlRunQuery {
	return {
		runId: input.runId,
		...(input.traceHeaders ? { traceHeaders: input.traceHeaders } : {}),
		...(input.traceId === undefined ? {} : { traceId: input.traceId }),
	};
}

/**
 * A run lookup is only a valid admission recovery when it is the exact run
 * that this app-api request created.  The execution-control endpoint is
 * addressed by run id, but checking all ownership fields protects the fence
 * from an upstream projection or routing mix-up.
 */
export function assertExecutionRunMatchesAdmission(
	input: AdmissionIdentityInput,
	run: AdmissionIdentityRun,
): void {
	const expectedTraceId = input.traceId?.trim() ?? "";
	if (
		run.runId !== input.runId ||
		run.requestId !== input.requestId ||
		run.conversationId !== input.conversationId ||
		run.ownerUserId !== input.ownerUserId ||
		run.surface !== input.surface ||
		run.traceId !== expectedTraceId ||
		run.turnId !== input.turnId
	) {
		throw new ExecutionControlTransportError({
			code: "admission_identity_conflict",
			message: "Execution durable run identity does not match the admission request.",
			retryable: false,
			status: 409,
		});
	}
}

/**
 * Only transport-style failures are safe to reconcile with GET.  Validation
 * and business conflicts (for example an active conversation run) are
 * definitive responses and must not be mistaken for a lost create response.
 */
export function isRecoverableAdmissionCreateError(error: unknown): boolean {
	return error instanceof ExecutionControlTransportError && error.retryable && error.status >= 500;
}

export function executionRunAdmissionTimestamp(run: {
	admittedAt: string;
	queuedAt: string;
	createdAt: string;
}): string {
	// Admission is dispatched after execution-control durably creates the run.
	// The create response is intentionally still in `created` until the start
	// reconciler launches Temporal, so admitted_at/queued_at may be empty.
	const timestamp = run.admittedAt.trim() || run.queuedAt.trim() || run.createdAt.trim();
	if (!(timestamp && Number.isFinite(Date.parse(timestamp)))) {
		throw new Error("Execution-control accepted a run without a valid admission timestamp.");
	}
	return timestamp;
}

function admissionInputHash(input: string): string {
	return createHash("sha256").update(input, "utf8").digest("hex");
}

class PermanentAdmissionFailure extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "PermanentAdmissionFailure";
		this.code = code;
	}
}

export function readFrozenChatAdmission(
	candidate: PendingChatAdmission,
): ExecutionControlRunCreateInput {
	if (admissionInputHash(candidate.admissionInputJson) !== candidate.admissionInputSha256) {
		throw new PermanentAdmissionFailure(
			"runtime_invariant_failed",
			`Frozen chat admission input hash mismatch for ${candidate.requestId}.`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(candidate.admissionInputJson) as unknown;
	} catch {
		throw new PermanentAdmissionFailure(
			"runtime_invariant_failed",
			`Frozen chat admission input is invalid JSON for ${candidate.requestId}.`,
		);
	}
	if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
		throw new PermanentAdmissionFailure(
			"runtime_invariant_failed",
			`Frozen chat admission input is not an object for ${candidate.requestId}.`,
		);
	}
	const workflowInput = parsed as Record<string, unknown>;
	const requestId = workflowInput.requestId;
	const runId = workflowInput.runId;
	if (typeof workflowInput.personalMemoryRecallAllowed !== "boolean") {
		throw new PermanentAdmissionFailure(
			"runtime_invariant_failed",
			`Frozen chat admission memory authorization is missing for ${candidate.requestId}.`,
		);
	}
	if (typeof runId !== "string" || !runId) {
		throw new PermanentAdmissionFailure(
			"runtime_invariant_failed",
			`Frozen chat admission run id is missing for ${candidate.requestId}.`,
		);
	}
	if (
		requestId !== candidate.requestId ||
		candidate.runId !== runId ||
		candidate.workflowId !== `campus-agent.chat.${runId}`
	) {
		throw new PermanentAdmissionFailure(
			"runtime_invariant_failed",
			`Frozen chat admission identity mismatch for ${candidate.requestId}.`,
		);
	}
	return workflowInput as unknown as ExecutionControlRunCreateInput;
}

function permanentAdmissionFailure(error: unknown): PermanentAdmissionFailure | null {
	if (error instanceof PermanentAdmissionFailure) {
		return error;
	}
	if (
		error instanceof ExecutionControlTransportError &&
		!isRecoverableAdmissionCreateError(error)
	) {
		return new PermanentAdmissionFailure(error.code, error.message);
	}
	return null;
}

export async function dispatchPendingChatAdmissions(input: {
	executionRuntime: ExecutionControlRuntimeClient;
	finalizeAdmissionFailure: (failure: ChatAdmissionFailureFinalization) => Promise<void>;
	limit?: number;
	store: ChatCommandStore;
}): Promise<ChatAdmissionDispatchResult> {
	const staleBefore = new Date(Date.now() - 30_000).toISOString();
	const candidates = await input.store.listPendingAdmissions({
		limit: input.limit ?? 25,
		staleBefore,
	});
	let admitted = 0;
	let failed = 0;
	for (const candidate of candidates) {
		try {
			const claimed = await input.store.claimAdmission({
				requestId: candidate.requestId,
				staleBefore,
				updatedAt: new Date().toISOString(),
				workflowId: candidate.workflowId,
			});
			if (!claimed) {
				continue;
			}
			const finalizePermanentFailure = async (error: PermanentAdmissionFailure) => {
				await input.finalizeAdmissionFailure({
					errorCode: error.code,
					requestId: candidate.requestId,
					runId: candidate.runId,
					workflowId: candidate.workflowId,
				});
			};
			let workflowInput: ExecutionControlRunCreateInput;
			try {
				workflowInput = readFrozenChatAdmission(candidate);
			} catch (error) {
				const permanent = permanentAdmissionFailure(error);
				if (!permanent) {
					throw error;
				}
				await finalizePermanentFailure(permanent);
				failed += 1;
				continue;
			}
			let run: ExecutionControlRun;
			try {
				run = await input.executionRuntime.createRun(workflowInput);
			} catch (error) {
				const permanent = permanentAdmissionFailure(error);
				if (permanent) {
					await finalizePermanentFailure(permanent);
					failed += 1;
					continue;
				}
				if (!isRecoverableAdmissionCreateError(error)) {
					await input.store.releaseAdmission({
						requestId: candidate.requestId,
						updatedAt: new Date().toISOString(),
						workflowId: candidate.workflowId,
					});
					failed += 1;
					continue;
				}
				try {
					run = await input.executionRuntime.getRun(buildAdmissionRunQuery(workflowInput));
					assertExecutionRunMatchesAdmission(workflowInput, run);
				} catch (recoveryError) {
					const permanentRecovery = permanentAdmissionFailure(recoveryError);
					if (permanentRecovery?.code === "admission_identity_conflict") {
						await finalizePermanentFailure(permanentRecovery);
						failed += 1;
						continue;
					}
					await input.store.releaseAdmission({
						requestId: candidate.requestId,
						updatedAt: new Date().toISOString(),
						workflowId: candidate.workflowId,
					});
					failed += 1;
					continue;
				}
			}
			try {
				assertExecutionRunMatchesAdmission(workflowInput, run);
			} catch (error) {
				const permanent = permanentAdmissionFailure(error);
				if (!permanent) {
					throw error;
				}
				await finalizePermanentFailure(permanent);
				failed += 1;
				continue;
			}
			let admittedAt: string;
			try {
				admittedAt = executionRunAdmissionTimestamp(run);
			} catch {
				await input.store.releaseAdmission({
					requestId: candidate.requestId,
					updatedAt: new Date().toISOString(),
					workflowId: candidate.workflowId,
				});
				failed += 1;
				continue;
			}
			let marked = false;
			try {
				marked = await input.store.markAdmitted({
					admittedAt,
					requestId: candidate.requestId,
					workflowId: candidate.workflowId,
				});
			} catch {
				// A response-lost store write is reconciled through the durable run
				// identity below before the conditional mark is retried once.
			}
			if (!marked) {
				// The execution-control write is idempotent, so a lost app-api
				// admission fence can be repaired without creating another run.
				try {
					const recovered = await input.executionRuntime.getRun(
						buildAdmissionRunQuery(workflowInput),
					);
					assertExecutionRunMatchesAdmission(workflowInput, recovered);
					marked = await input.store.markAdmitted({
						admittedAt: executionRunAdmissionTimestamp(recovered),
						requestId: candidate.requestId,
						workflowId: candidate.workflowId,
					});
				} catch (recoveryError) {
					const permanentRecovery = permanentAdmissionFailure(recoveryError);
					if (permanentRecovery?.code === "admission_identity_conflict") {
						await finalizePermanentFailure(permanentRecovery);
						failed += 1;
						continue;
					}
					await input.store.releaseAdmission({
						requestId: candidate.requestId,
						updatedAt: new Date().toISOString(),
						workflowId: candidate.workflowId,
					});
					failed += 1;
					continue;
				}
			}
			if (marked) {
				admitted += 1;
			} else {
				await input.store.releaseAdmission({
					requestId: candidate.requestId,
					updatedAt: new Date().toISOString(),
					workflowId: candidate.workflowId,
				});
				failed += 1;
			}
		} catch {
			// A finalizer or post-create confirmation failure keeps the claim
			// closed. The stale-claim window retries it without a hot loop, while
			// a response-lost successful finalization is excluded by product status.
			failed += 1;
		}
	}
	return { admitted, failed, processed: candidates.length };
}
