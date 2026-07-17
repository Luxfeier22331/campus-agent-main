import { createHash } from "node:crypto";

import type { ExecutionControlRunCreateInput, ExecutionControlRuntimeClient } from "../integration";
import type { ChatCommandStore, PendingChatAdmission } from "./store-types";

export interface ChatAdmissionDispatchResult {
	admitted: number;
	failed: number;
	processed: number;
}

export function executionRunAdmissionTimestamp(run: {
	admittedAt: string;
	queuedAt: string;
}): string {
	const timestamp = run.admittedAt.trim() || run.queuedAt.trim();
	if (!(timestamp && Number.isFinite(Date.parse(timestamp)))) {
		throw new Error("Execution-control accepted a run without a valid admission timestamp.");
	}
	return timestamp;
}

function admissionInputHash(input: Record<string, unknown>): string {
	return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

function assertFrozenAdmission(candidate: PendingChatAdmission): void {
	if (admissionInputHash(candidate.workflowInput) !== candidate.workflowInputSha256) {
		throw new Error(`Frozen chat admission input hash mismatch for ${candidate.requestId}.`);
	}
	const runId = candidate.workflowInput.runId;
	if (candidate.workflowId !== `campus-agent.chat.${runId}`) {
		throw new Error(`Frozen chat admission workflow id mismatch for ${candidate.requestId}.`);
	}
}

export async function dispatchPendingChatAdmissions(input: {
	executionRuntime: ExecutionControlRuntimeClient;
	limit?: number;
	store: ChatCommandStore;
}): Promise<ChatAdmissionDispatchResult> {
	const candidates = await input.store.listPendingAdmissions({ limit: input.limit ?? 25 });
	let admitted = 0;
	let failed = 0;
	for (const candidate of candidates) {
		try {
			assertFrozenAdmission(candidate);
			const run = await input.executionRuntime.createRun(
				candidate.workflowInput as unknown as ExecutionControlRunCreateInput,
			);
			const marked = await input.store.markAdmitted({
				admittedAt: executionRunAdmissionTimestamp(run),
				requestId: candidate.requestId,
				workflowId: candidate.workflowId,
			});
			if (marked) {
				admitted += 1;
			}
		} catch {
			failed += 1;
		}
	}
	return { admitted, failed, processed: candidates.length };
}
