export const STAGING_CHAT_SMOKE_EXPECTED_RESULT_KINDS = ["answer", "any"] as const;

export type StagingChatSmokeExpectedResultKind =
	(typeof STAGING_CHAT_SMOKE_EXPECTED_RESULT_KINDS)[number];

export function parseStagingChatSmokeExpectedResultKind(
	value: string,
): StagingChatSmokeExpectedResultKind {
	if ((STAGING_CHAT_SMOKE_EXPECTED_RESULT_KINDS as readonly string[]).includes(value)) {
		return value as StagingChatSmokeExpectedResultKind;
	}

	throw new Error(
		`--expect-result-kind must be one of: ${STAGING_CHAT_SMOKE_EXPECTED_RESULT_KINDS.join(", ")}.`,
	);
}

export function assertExpectedStagingChatSmokeResultKind(input: {
	actual: string;
	expected: StagingChatSmokeExpectedResultKind;
	requestId: string;
	traceId: string;
}): void {
	if (input.expected === "any" || input.actual === input.expected) {
		return;
	}

	throw new Error(
		`Expected staging chat smoke result kind ${input.expected}, got ${input.actual} (requestId=${input.requestId} traceId=${input.traceId}).`,
	);
}
