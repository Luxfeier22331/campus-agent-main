export type NoticeJobErrorCode =
	| "connection_refused"
	| "dns_resolution_failed"
	| "job_failed"
	| "network_timeout";

const ERROR_MESSAGES: Record<NoticeJobErrorCode, string> = {
	connection_refused: "Connection refused.",
	dns_resolution_failed: "DNS resolution failed.",
	job_failed: "Notice job failed.",
	network_timeout: "Network request timed out.",
};

export function formatNoticeJobError(error: unknown): string {
	const errorCode = noticeJobErrorCode(error);
	return JSON.stringify({ error_code: errorCode, message: ERROR_MESSAGES[errorCode] });
}

export function noticeJobErrorCode(error: unknown): NoticeJobErrorCode {
	const indicators = errorIndicators(error).join(" ").toUpperCase();
	if (indicators.includes("ENOTFOUND") || indicators.includes("EAI_AGAIN")) {
		return "dns_resolution_failed";
	}
	if (indicators.includes("ECONNREFUSED")) {
		return "connection_refused";
	}
	if (
		indicators.includes("ETIMEDOUT") ||
		indicators.includes("UND_ERR_CONNECT_TIMEOUT") ||
		indicators.includes("UND_ERR_HEADERS_TIMEOUT") ||
		indicators.includes("UND_ERR_BODY_TIMEOUT")
	) {
		return "network_timeout";
	}
	return "job_failed";
}

function errorIndicators(error: unknown): string[] {
	if (!(error && typeof error === "object")) {
		return [String(error)];
	}
	const value = error as { cause?: unknown; code?: unknown; message?: unknown };
	return [
		typeof value.code === "string" ? value.code : "",
		typeof value.message === "string" ? value.message : "",
		...(value.cause === undefined ? [] : errorIndicators(value.cause)),
	];
}
