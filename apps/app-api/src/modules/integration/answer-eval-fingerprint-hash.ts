import { sha256JsonRef } from "./llm-io-fingerprint-hash";
import type { ToolExecutionAnswerEvalFingerprint } from "./tool-execution-types";

export function answerEvalFingerprintSha256(
	fingerprint: ToolExecutionAnswerEvalFingerprint,
): string {
	const body = toContractAnswerEvalFingerprint(fingerprint);
	delete body.answer_fingerprint_sha256;
	return sha256JsonRef(body);
}

export function toContractAnswerEvalFingerprint(
	fingerprint: ToolExecutionAnswerEvalFingerprint,
): Record<string, unknown> & { answer_fingerprint_sha256?: string } {
	return {
		answer_fingerprint_sha256: fingerprint.answerFingerprintSha256,
		branch_identity: {
			branch_kind: fingerprint.branchIdentity.branchKind,
			prompt_id: fingerprint.branchIdentity.promptId,
			schema_version: fingerprint.branchIdentity.schemaVersion,
			workflow_mode: fingerprint.branchIdentity.workflowMode,
		},
		evidence_replay_index_sha256: fingerprint.evidenceReplayIndexSha256 ?? null,
		llm_call_site: fingerprint.llmCallSite,
		llm_io_fingerprint_sha256: fingerprint.llmIoFingerprintSha256,
		output_schema_id: fingerprint.outputSchemaId,
		provider_profile_revision: fingerprint.providerProfileRevision,
		request_id: fingerprint.requestId,
		run_id: fingerprint.runId,
		runtime_release: fingerprint.runtimeRelease,
		schema_version: fingerprint.schemaVersion,
		selected_tool: fingerprint.selectedTool,
		selected_tools: fingerprint.selectedTools,
		stage_timing_profile_sha256: fingerprint.stageTimingProfileSha256,
		terminal_outcome: fingerprint.terminalOutcome,
		tool_runtime_combined_sha256: fingerprint.toolRuntimeCombinedSha256,
		trace_id: fingerprint.traceId,
	};
}
