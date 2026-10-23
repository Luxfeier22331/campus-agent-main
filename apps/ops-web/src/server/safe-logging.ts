const SAFE_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/u;

type OpsLogContext = Record<string, boolean | number | string | null>;

export function logOpsEvent(eventType: string, status: string, context: OpsLogContext = {}) {
	console.info(JSON.stringify(buildOpsLogEvent(eventType, "info", status, context)));
}

export function logOpsError(eventType: string, error: unknown, context: OpsLogContext = {}) {
	const errorRecord = isRecord(error) ? error : {};
	const rawCode = typeof errorRecord.code === "string" ? errorRecord.code : null;
	const errorCode =
		rawCode && SAFE_CODE_PATTERN.test(rawCode)
			? rawCode
			: error instanceof Error && SAFE_CODE_PATTERN.test(error.name)
				? error.name
				: "UNCLASSIFIED";
	console.error(JSON.stringify(buildOpsLogEvent(eventType, "error", "failed", context, errorCode)));
}

function buildOpsLogEvent(
	eventType: string,
	level: "error" | "info",
	status: string,
	context: OpsLogContext,
	errorCode?: string,
) {
	return {
		...context,
		...(errorCode ? { error_code: errorCode } : {}),
		event_type: SAFE_CODE_PATTERN.test(eventType) ? eventType : "ops_web.invalid_event",
		level,
		status: SAFE_CODE_PATTERN.test(status) ? status : "unknown",
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
