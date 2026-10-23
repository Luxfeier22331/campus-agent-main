export function formatRawError(error: unknown): string {
	const seen = new Set<unknown>();
	return format(error, seen);
}

function format(error: unknown, seen: Set<unknown>): string {
	if (!(error instanceof Error)) {
		return String(error);
	}
	if (seen.has(error)) {
		return "[circular error cause]";
	}
	seen.add(error);
	const primary = error.stack ?? `${error.name}: ${error.message}`;
	if (!("cause" in error) || error.cause === undefined) {
		return primary;
	}
	return `${primary}\nCaused by: ${format(error.cause, seen)}`;
}
