const SAFE_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/u;

type AgentRuntimeLogContext = Record<string, boolean | number | string | null>;

export function logAgentRuntimeEvent(
	level: "error" | "info",
	eventType: string,
	status: string,
	context: AgentRuntimeLogContext = {},
) {
	const serialized = JSON.stringify({
		...context,
		event_type: safeCode(eventType, "agent_runtime.invalid_event"),
		level,
		status: safeCode(status, "unknown"),
	});
	if (level === "error") {
		console.error(serialized);
		return;
	}
	console.info(serialized);
}

export function safeAgentRuntimeErrorCode(error: unknown) {
	if (typeof error === "object" && error !== null && !Array.isArray(error)) {
		const code = (error as { code?: unknown }).code;
		if (typeof code === "string" && SAFE_CODE_PATTERN.test(code)) {
			return code;
		}
	}
	return error instanceof Error ? safeCode(error.name, "UNCLASSIFIED") : "UNCLASSIFIED";
}

function safeCode(value: string, fallback: string) {
	return SAFE_CODE_PATTERN.test(value) ? value : fallback;
}
