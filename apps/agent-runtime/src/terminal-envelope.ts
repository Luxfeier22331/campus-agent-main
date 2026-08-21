import type {
	PrimaryAgentTerminalEnvelope,
	PrimaryAgentTerminalKind,
} from "./agent-run-contract.ts";

export function terminalEnvelopeFromUnknown(
	value: unknown,
): PrimaryAgentTerminalEnvelope | undefined {
	const record = recordFromUnknown(value);
	if (record === undefined) {
		return;
	}
	const allowedKeys = new Set(["answerText", "followUpQuestion", "kind", "reason"]);
	if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
		return;
	}
	const kind = stringFromUnknown(record.kind);
	if (!isPrimaryAgentTerminalKind(kind)) {
		return;
	}
	const envelope: PrimaryAgentTerminalEnvelope = { kind };
	const answerText = stringFromUnknown(record.answerText);
	if (answerText !== "") {
		envelope.answerText = answerText;
	}
	const followUpQuestion = stringFromUnknown(record.followUpQuestion);
	if (followUpQuestion !== "") {
		envelope.followUpQuestion = followUpQuestion;
	}
	const reason = stringFromUnknown(record.reason);
	if (reason !== "") {
		envelope.reason = reason;
	}
	if (kind === "answer" && envelope.answerText === undefined) {
		return;
	}
	if (
		kind === "clarification_required" &&
		envelope.followUpQuestion === undefined &&
		envelope.answerText === undefined
	) {
		return;
	}
	if (
		(kind === "out_of_scope" || kind === "policy_refusal" || kind === "unsupported_by_evidence") &&
		envelope.reason === undefined &&
		envelope.answerText === undefined
	) {
		return;
	}
	return envelope;
}

export function finalOutputFromTerminalEnvelope(envelope: PrimaryAgentTerminalEnvelope): string {
	switch (envelope.kind) {
		case "clarification_required":
			return envelope.followUpQuestion ?? envelope.answerText ?? "";
		case "answer":
			return envelope.answerText ?? "";
		default:
			return envelope.answerText ?? envelope.reason ?? "";
	}
}

function isPrimaryAgentTerminalKind(value: string): value is PrimaryAgentTerminalKind {
	return (
		value === "answer" ||
		value === "clarification_required" ||
		value === "out_of_scope" ||
		value === "policy_refusal" ||
		value === "unsupported_by_evidence"
	);
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return;
	}
	return value as Record<string, unknown>;
}

function stringFromUnknown(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}
