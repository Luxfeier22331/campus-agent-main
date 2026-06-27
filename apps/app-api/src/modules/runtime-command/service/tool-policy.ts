import { createPreAcceptError } from "./errors";

const ACCEPTED_EXPLICIT_CHAT_TOOLS = new Set([
	"knowledge_query",
	"place_lookup",
	"transport_schedule_lookup",
	"campus_notice_discover",
	"campus_notice_change_set_lookup",
	"campus_notice_period_summary",
]);

function normalizeRequestedTool(value: unknown): string | null {
	const tool = typeof value === "string" ? value.trim() : "";
	return tool || null;
}

export function resolveRequestedToolForSurface(input: {
	requestedTool: unknown;
	surface: string;
}): string | null {
	const requestedTool = normalizeRequestedTool(input.requestedTool);
	if (requestedTool === null) {
		return null;
	}

	if (ACCEPTED_EXPLICIT_CHAT_TOOLS.has(requestedTool)) {
		return requestedTool;
	}

	throw createPreAcceptError({
		code: "validation_failed",
		details: { field: "requestedTool", surface: input.surface },
		message: "Requested tool is not admitted on this route.",
		status: 422,
	});
}
