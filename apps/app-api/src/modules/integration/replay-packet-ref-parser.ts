import type { ToolExecutionObservability } from "./tool-execution-types";

const REPLAY_PACKET_REF_FIELDS = [
	"schema_version",
	"packet_id",
	"object_ref",
	"object_checksum_sha256",
	"sensitivity_classification",
	"encryption_key_ref",
	"created_at",
	"expires_at",
	"approval_ref",
	"operator_principal",
] as const;
const REPLAY_PACKET_REF_FIELD_SET = new Set<string>(REPLAY_PACKET_REF_FIELDS);

const FORBIDDEN_REPLAY_PACKET_REF_KEY_TOKENS = [
	"raw_answer",
	"raw_prompt",
	"raw_transcript",
	"provider_request_body",
	"provider_response_body",
	"provider_stream_deltas",
	"provider_raw_response",
	"raw_response",
	"jwt",
	"authorization",
	"cookie",
	"auth_envelope",
	"retrieval_backend_dump",
];

class ReplayPacketRefContractError extends Error {
	constructor(message: string) {
		super(`execution finalization response contract violation: ${message}`);
		this.name = "ReplayPacketRefContractError";
	}
}

export function parseReplayPacketRef(
	value: unknown,
): ToolExecutionObservability["replayPacketRef"] {
	if (value === null || value === undefined) {
		return null;
	}
	const record = getRecord(value);
	if (!record || containsForbiddenReplayPacketRefKey(record)) {
		throw new ReplayPacketRefContractError("observability.replay_packet_ref must be a safe object");
	}
	for (const key of Object.keys(record)) {
		if (!REPLAY_PACKET_REF_FIELD_SET.has(key)) {
			throw new ReplayPacketRefContractError(
				`observability.replay_packet_ref.${key} is not allowed`,
			);
		}
	}
	if (record.schema_version !== "llm_replay_packet_index_ref.v1") {
		throw new ReplayPacketRefContractError(
			"observability.replay_packet_ref.schema_version is invalid",
		);
	}
	return {
		approvalRef: normalizeNullableString(record.approval_ref),
		createdAt: requireReplayPacketRefTimestamp(record, "created_at"),
		encryptionKeyRef: requireReplayPacketRefString(record, "encryption_key_ref"),
		expiresAt: requireReplayPacketRefTimestamp(record, "expires_at"),
		objectChecksumSha256: requireSha256ReplayPacketRef(record, "object_checksum_sha256"),
		objectRef: requireReplayPacketRefString(record, "object_ref"),
		operatorPrincipal: normalizeNullableString(record.operator_principal),
		packetId: requireReplayPacketRefString(record, "packet_id"),
		schemaVersion: "llm_replay_packet_index_ref.v1",
		sensitivityClassification: requireReplayPacketRefString(record, "sensitivity_classification"),
	};
}

function requireReplayPacketRefString(
	record: Record<string, unknown>,
	field: (typeof REPLAY_PACKET_REF_FIELDS)[number],
): string {
	const value = normalizeNullableString(record[field]);
	if (!value) {
		throw new ReplayPacketRefContractError(`observability.replay_packet_ref.${field} is required`);
	}
	return value;
}

function requireReplayPacketRefTimestamp(
	record: Record<string, unknown>,
	field: (typeof REPLAY_PACKET_REF_FIELDS)[number],
): string {
	const value = requireReplayPacketRefString(record, field);
	if (Number.isNaN(new Date(value).valueOf())) {
		throw new ReplayPacketRefContractError(
			`observability.replay_packet_ref.${field} must be an ISO timestamp`,
		);
	}
	return value;
}

function requireSha256ReplayPacketRef(
	record: Record<string, unknown>,
	field: (typeof REPLAY_PACKET_REF_FIELDS)[number],
): string {
	const value = requireReplayPacketRefString(record, field);
	if (!isSha256Ref(value)) {
		throw new ReplayPacketRefContractError(
			`observability.replay_packet_ref.${field} must be a sha256 reference`,
		);
	}
	return value;
}

function containsForbiddenReplayPacketRefKey(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some((item) => containsForbiddenReplayPacketRefKey(item));
	}
	const record = getRecord(value);
	if (!record) {
		return false;
	}
	return Object.entries(record).some(
		([key, item]) =>
			FORBIDDEN_REPLAY_PACKET_REF_KEY_TOKENS.some((token) => key.toLowerCase().includes(token)) ||
			containsForbiddenReplayPacketRefKey(item),
	);
}

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function normalizeNullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function isSha256Ref(value: string): boolean {
	const hash = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
	return /^[a-f0-9]{64}$/.test(hash);
}
