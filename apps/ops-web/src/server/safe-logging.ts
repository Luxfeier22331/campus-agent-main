const SAFE_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/u;

export function logOpsError(
	event: string,
	error: unknown,
	context: Record<string, boolean | number | string | null> = {},
) {
	const errorRecord = isRecord(error) ? error : {};
	const rawCode = typeof errorRecord.code === "string" ? errorRecord.code : null;
	const errorCode = rawCode && SAFE_CODE_PATTERN.test(rawCode) ? rawCode : "UNCLASSIFIED";
	const errorName =
		error instanceof Error && SAFE_CODE_PATTERN.test(error.name) ? error.name : "UnknownError";
	console.error(`[ops-web] ${event}`, { ...context, errorCode, errorName });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
