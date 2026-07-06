import type { ToolExecutionAnswerEvalFingerprint } from "./tool-execution-types";

const ANSWER_EVAL_FINGERPRINT_FIELDS = [
	"schema_version",
	"answer_fingerprint_sha256",
	"run_id",
	"request_id",
	"trace_id",
	"runtime_release",
	"llm_call_site",
	"llm_io_fingerprint_sha256",
	"provider_profile_revision",
	"output_schema_id",
	"branch_identity",
	"terminal_outcome",
	"selected_tool",
	"selected_tools",
	"stage_timing_profile_sha256",
	"tool_runtime_combined_sha256",
	"evidence_replay_index_sha256",
] as const;

const ANSWER_EVAL_FINGERPRINT_FIELD_SET = new Set<string>(ANSWER_EVAL_FINGERPRINT_FIELDS);
const ANSWER_BRANCH_IDENTITY_FIELDS = new Set([
	"schema_version",
	"prompt_id",
	"branch_kind",
	"workflow_mode",
]);
const LLM_CALL_SITES = new Set(["agent.primary", "rag.synthesis"]);
const ANSWER_BRANCH_KINDS = new Set([
	"direct_no_tool",
	"tool_routed",
	"rag_synthesis",
	"clarification",
	"policy_refusal",
	"runtime_error",
]);

const FORBIDDEN_ANSWER_EVAL_FINGERPRINT_KEY_TOKENS = [
	"raw_answer",
	"raw_prompt",
	"raw_transcript",
	"provider_body",
	"provider_request_body",
	"provider_response_body",
	"provider_stream_deltas",
	"provider_raw_response",
	"raw_response",
	"jwt",
	"authorization",
	"cookie",
	"auth_envelope",
	"memory_payload",
	"memory_raw",
	"memory_text",
	"retrieval_backend_dump",
	"secret",
	"tool_args",
	"tool_arguments",
];

class AnswerEvalFingerprintContractError extends Error {
	constructor(message: string) {
		super(`execution finalization response contract violation: ${message}`);
		this.name = "AnswerEvalFingerprintContractError";
	}
}

export function parseAnswerEvalFingerprint(
	value: unknown,
): ToolExecutionAnswerEvalFingerprint | null {
	if (value === null || value === undefined) {
		return null;
	}
	const record = getRecord(value);
	if (!record || containsForbiddenAnswerEvalFingerprintKey(record)) {
		throw new AnswerEvalFingerprintContractError(
			"observability.answer_eval_fingerprint must be a safe object",
		);
	}
	for (const key of Object.keys(record)) {
		if (!ANSWER_EVAL_FINGERPRINT_FIELD_SET.has(key)) {
			throw new AnswerEvalFingerprintContractError(
				`observability.answer_eval_fingerprint.${key} is not allowed`,
			);
		}
	}
	if (record.schema_version !== "answer_eval_fingerprint.v1") {
		throw new AnswerEvalFingerprintContractError(
			"observability.answer_eval_fingerprint.schema_version is invalid",
		);
	}
	return {
		answerFingerprintSha256: requireSha256Ref(record, "answer_fingerprint_sha256"),
		branchIdentity: parseBranchIdentity(record.branch_identity),
		evidenceReplayIndexSha256: optionalSha256Ref(record.evidence_replay_index_sha256),
		llmCallSite: requireEnum(
			record,
			"llm_call_site",
			LLM_CALL_SITES,
		) as ToolExecutionAnswerEvalFingerprint["llmCallSite"],
		llmIoFingerprintSha256: requireSha256Ref(record, "llm_io_fingerprint_sha256"),
		outputSchemaId: requireNonEmptyString(record, "output_schema_id"),
		providerProfileRevision: requireNonEmptyString(record, "provider_profile_revision"),
		requestId: requireNonEmptyString(record, "request_id"),
		runId: requireNonEmptyString(record, "run_id"),
		runtimeRelease: requireNonEmptyString(record, "runtime_release"),
		schemaVersion: "answer_eval_fingerprint.v1",
		selectedTool:
			record.selected_tool === null ? null : requireNonEmptyString(record, "selected_tool"),
		selectedTools: parseSelectedTools(record.selected_tools),
		stageTimingProfileSha256: requireSha256Ref(record, "stage_timing_profile_sha256"),
		terminalOutcome: requireNonEmptyString(record, "terminal_outcome"),
		toolRuntimeCombinedSha256: requireSha256Ref(record, "tool_runtime_combined_sha256"),
		traceId: requireNonEmptyString(record, "trace_id"),
	};
}

function parseBranchIdentity(value: unknown): ToolExecutionAnswerEvalFingerprint["branchIdentity"] {
	const record = getRecord(value);
	if (!record || containsForbiddenAnswerEvalFingerprintKey(record)) {
		throw new AnswerEvalFingerprintContractError(
			"observability.answer_eval_fingerprint.branch_identity must be a safe object",
		);
	}
	for (const key of Object.keys(record)) {
		if (!ANSWER_BRANCH_IDENTITY_FIELDS.has(key)) {
			throw new AnswerEvalFingerprintContractError(
				`observability.answer_eval_fingerprint.branch_identity.${key} is not allowed`,
			);
		}
	}
	if (record.schema_version !== "answer_branch_identity.v1") {
		throw new AnswerEvalFingerprintContractError(
			"observability.answer_eval_fingerprint.branch_identity.schema_version is invalid",
		);
	}
	return {
		branchKind: requireEnum(
			record,
			"branch_identity.branch_kind",
			ANSWER_BRANCH_KINDS,
		) as ToolExecutionAnswerEvalFingerprint["branchIdentity"]["branchKind"],
		promptId: requireNestedString(record, "branch_identity.prompt_id"),
		schemaVersion: "answer_branch_identity.v1",
		workflowMode: requireNestedString(record, "branch_identity.workflow_mode"),
	};
}

function parseSelectedTools(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw new AnswerEvalFingerprintContractError(
			"observability.answer_eval_fingerprint.selected_tools must be an array",
		);
	}
	const items = value.map((item, index) => {
		if (!(typeof item === "string" && item.trim())) {
			throw new AnswerEvalFingerprintContractError(
				`observability.answer_eval_fingerprint.selected_tools[${index}] is invalid`,
			);
		}
		return item;
	});
	if (new Set(items).size !== items.length) {
		throw new AnswerEvalFingerprintContractError(
			"observability.answer_eval_fingerprint.selected_tools must be unique",
		);
	}
	return items;
}

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function containsForbiddenAnswerEvalFingerprintKey(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some((item) => containsForbiddenAnswerEvalFingerprintKey(item));
	}
	const record = getRecord(value);
	if (!record) {
		return false;
	}
	return Object.entries(record).some(
		([key, item]) =>
			FORBIDDEN_ANSWER_EVAL_FINGERPRINT_KEY_TOKENS.some((token) =>
				normalizeToken(key).includes(normalizeToken(token)),
			) || containsForbiddenAnswerEvalFingerprintKey(item),
	);
}

function normalizeToken(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

function normalizeNullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function requireNonEmptyString(
	record: Record<string, unknown>,
	field: (typeof ANSWER_EVAL_FINGERPRINT_FIELDS)[number],
): string {
	const value = normalizeNullableString(record[field]);
	if (!value) {
		throw new AnswerEvalFingerprintContractError(
			`observability.answer_eval_fingerprint.${field} is required`,
		);
	}
	return value;
}

function requireNestedString(record: Record<string, unknown>, field: string): string {
	const key = field.split(".").at(-1) ?? field;
	const value = normalizeNullableString(record[key]);
	if (!value) {
		throw new AnswerEvalFingerprintContractError(
			`observability.answer_eval_fingerprint.${field} is required`,
		);
	}
	return value;
}

function requireSha256Ref(
	record: Record<string, unknown>,
	field: (typeof ANSWER_EVAL_FINGERPRINT_FIELDS)[number],
): string {
	const value = requireNonEmptyString(record, field);
	if (!isSha256Ref(value)) {
		throw new AnswerEvalFingerprintContractError(
			`observability.answer_eval_fingerprint.${field} must be a sha256 reference`,
		);
	}
	return value;
}

function optionalSha256Ref(value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (!(typeof value === "string" && isSha256Ref(value))) {
		throw new AnswerEvalFingerprintContractError(
			"observability.answer_eval_fingerprint.evidence_replay_index_sha256 must be a sha256 reference or null",
		);
	}
	return value;
}

function requireEnum<T extends string>(
	record: Record<string, unknown>,
	field: string,
	allowed: ReadonlySet<T>,
): T {
	const key = field.split(".").at(-1) ?? field;
	const value = normalizeNullableString(record[key]);
	if (!(value && allowed.has(value as T))) {
		throw new AnswerEvalFingerprintContractError(
			`observability.answer_eval_fingerprint.${field} is invalid`,
		);
	}
	return value as T;
}

function isSha256Ref(value: string): boolean {
	const hash = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
	return /^[a-f0-9]{64}$/.test(hash);
}
