import { createHash } from "node:crypto";

export const textEncoder = new TextEncoder();

export function parseDateTime(value: string): string | null {
	const normalized = value.trim();
	const localMatch =
		/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[ T](?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?$/.exec(
			normalized,
		);
	if (localMatch?.groups) {
		const { day, hour, minute, month, second = "00", year } = localMatch.groups;
		const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
		return Number.isNaN(date.valueOf()) ? null : date.toISOString();
	}
	const date = new Date(normalized);
	return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function extractYear(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const match = /(?<year>19\d{2}|20\d{2})/.exec(value);
	return match?.groups?.year ?? null;
}

export function normalizeUrl(value: string): string {
	const parsed = new URL(value.trim());
	parsed.hash = "";
	return parsed.toString();
}

export function normalizeOptionalUrl(value: string | null): string | null {
	return value ? normalizeUrl(value) : null;
}

export function firstText(...values: unknown[]): string {
	for (const value of values) {
		const normalized = optionalText(value);
		if (normalized) {
			return normalized;
		}
	}
	return "";
}

export function requireText(value: unknown, field: string): string {
	const normalized = optionalText(value);
	if (!normalized) {
		throw new Error(`${field} is required`);
	}
	return normalized;
}

export function optionalText(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeText(value: string): string {
	return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizeIsoTimestamp(value: string, field: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) {
		throw new Error(`${field} must be a valid ISO timestamp`);
	}
	return date.toISOString();
}

export function normalizeOptionalIsoTimestamp(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const date = new Date(value);
	return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function dedupeUrls(values: string[]): string[] {
	const deduped = new Map<string, string>();
	for (const value of values) {
		const normalized = optionalText(value);
		if (!normalized) {
			continue;
		}
		const canonical = normalizeUrl(normalized);
		if (!deduped.has(canonical)) {
			deduped.set(canonical, canonical);
		}
	}
	return [...deduped.values()];
}

export function hashJson(value: Record<string, unknown>): string {
	return sha256Hex(JSON.stringify(value));
}

export function prefixedHash(prefix: string, value: string, length: number): string {
	return `${prefix}_${sha256Hex(value).slice(0, length)}`;
}

export function sha256Hex(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

export function encodeJson(value: unknown): Uint8Array {
	return textEncoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

export function encodeJsonl(rows: unknown[]): Uint8Array {
	return textEncoder.encode(
		rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : ""),
	);
}

export function validatePathSegment(value: string, field: string): string {
	const normalized = value.trim();
	if (!normalized || normalized.includes("/")) {
		throw new Error(`${field} must be a non-empty path segment`);
	}
	return normalized;
}

export function validateFilename(value: string): string {
	if (!value || value.includes("/")) {
		throw new Error("filename must be a basename");
	}
	return value;
}
