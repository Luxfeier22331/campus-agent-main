export type JsonObject = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(value: unknown, field: string): string {
	const normalized = typeof value === "string" ? value.trim() : String(value ?? "").trim();
	if (!normalized) {
		throw new Error(`${field} is required`);
	}
	return normalized;
}

export function optionalString(value: unknown): string | null {
	const normalized = typeof value === "string" ? value.trim() : String(value ?? "").trim();
	return normalized || null;
}
