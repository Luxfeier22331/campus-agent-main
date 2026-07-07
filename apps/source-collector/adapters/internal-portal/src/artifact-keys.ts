export function sanitizeObjectKeySegment(value: string): string {
	const normalized = value.trim().replace(/[^0-9A-Za-z_.=-]+/g, "_");
	return normalized || "unknown";
}
