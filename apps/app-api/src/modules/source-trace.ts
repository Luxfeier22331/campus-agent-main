export interface ObservedSourceTraceEntry {
	canonicalUrl: string;
	sourceKind: string | null;
	sourceTitle: string;
	targetKind: string | null;
	versionId: string | null;
}

export const REQUEST_SOURCE_TRACE_LIMIT = 10;

export function normalizeDocsReaderPath(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const canonicalUrl = value.trim();
	if (
		!canonicalUrl.startsWith("/docs/") ||
		canonicalUrl.startsWith("//") ||
		canonicalUrl.includes("://") ||
		canonicalUrl.includes("..")
	) {
		return null;
	}

	const [withoutHash = ""] = canonicalUrl.split("#", 1);
	const [path = ""] = withoutHash.split("?", 1);
	const normalizedPath = path.replace(/\/+$/u, "");
	return normalizedPath.startsWith("/docs/") && normalizedPath.length > "/docs/".length
		? normalizedPath
		: null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readString(record: Record<string, unknown>, snake: string, camel: string): string | null {
	const snakeValue = record[snake];
	if (typeof snakeValue === "string" && snakeValue.trim()) {
		return snakeValue;
	}
	const camelValue = record[camel];
	return typeof camelValue === "string" && camelValue.trim() ? camelValue : null;
}

export function summarizeObservedSources(
	value: unknown,
	limit = REQUEST_SOURCE_TRACE_LIMIT,
): ObservedSourceTraceEntry[] {
	if (!Array.isArray(value) || limit <= 0) {
		return [];
	}

	const entries: ObservedSourceTraceEntry[] = [];
	for (const item of value) {
		const record = getRecord(item);
		if (!record) {
			continue;
		}
		const rawCanonicalUrl = readString(record, "canonical_url", "canonicalUrl");
		const canonicalUrl = rawCanonicalUrl?.startsWith("/docs/")
			? normalizeDocsReaderPath(rawCanonicalUrl)
			: rawCanonicalUrl;
		const sourceTitle =
			readString(record, "source_title", "sourceTitle") ?? readString(record, "title", "title");
		if (!(canonicalUrl && sourceTitle)) {
			continue;
		}
		entries.push({
			canonicalUrl,
			sourceKind: readString(record, "source_kind", "sourceKind"),
			sourceTitle,
			targetKind: readString(record, "target_kind", "targetKind"),
			versionId: readString(record, "version_id", "versionId"),
		});
		if (entries.length >= limit) {
			break;
		}
	}
	return entries;
}

export function extractObservedSourcesFromResult(
	result: unknown,
	limit = REQUEST_SOURCE_TRACE_LIMIT,
): ObservedSourceTraceEntry[] {
	const record = getRecord(result);
	return summarizeObservedSources(record?.sources, limit);
}
