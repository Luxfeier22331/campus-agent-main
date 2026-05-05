export const CHAT_E2E_EXPECTED_RESULT_KINDS = ["answer", "any"] as const;

export type ChatE2eExpectedResultKind = (typeof CHAT_E2E_EXPECTED_RESULT_KINDS)[number];

export function parseChatE2eExpectedResultKind(value: string): ChatE2eExpectedResultKind {
	if ((CHAT_E2E_EXPECTED_RESULT_KINDS as readonly string[]).includes(value)) {
		return value as ChatE2eExpectedResultKind;
	}

	throw new Error(
		`--expect-result-kind must be one of: ${CHAT_E2E_EXPECTED_RESULT_KINDS.join(", ")}.`,
	);
}

export function assertExpectedChatE2eResultKind(input: {
	actual: string;
	expected: ChatE2eExpectedResultKind;
	requestId: string;
	traceId: string;
}): void {
	if (input.expected === "any" || input.actual === input.expected) {
		return;
	}

	throw new Error(
		`Expected chat e2e result kind ${input.expected}, got ${input.actual} (requestId=${input.requestId} traceId=${input.traceId}).`,
	);
}
