import { createPreAcceptError } from "./errors";

const ACCEPTED_EXPLICIT_CHAT_CAPABILITIES = new Set(["knowledge"]);

function normalizeRequestedCapability(value: unknown): string | null {
	const capability = typeof value === "string" ? value.trim() : "";
	return capability || null;
}

export function resolveRequestedCapabilityForSurface(input: {
	requestedCapability: unknown;
	surface: string;
}): string | null {
	const requestedCapability = normalizeRequestedCapability(input.requestedCapability);
	if (requestedCapability === null) {
		return null;
	}

	if (ACCEPTED_EXPLICIT_CHAT_CAPABILITIES.has(requestedCapability)) {
		return requestedCapability;
	}

	throw createPreAcceptError({
		code: "validation_failed",
		details: { field: "requestedCapability", surface: input.surface },
		message: "Only knowledge requests are accepted on this route.",
		status: 422,
	});
}
