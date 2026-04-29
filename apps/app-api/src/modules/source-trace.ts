export interface ObservedSourceTraceEntry {
	docId: string;
	chunkId: string | null;
	score: number | null;
	collection: string | null;
	sourceTitle: string | null;
	canonicalSourceId: string | null;
	canonicalSourceTitle: string | null;
	sourceUnitKind: string | null;
	sourceUnitKey: string | null;
}

export const REQUEST_SOURCE_TRACE_LIMIT = 10;

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

function readNumber(record: Record<string, unknown>, snake: string, camel: string): number | null {
	const snakeValue = record[snake];
	if (Number.isFinite(snakeValue)) {
		return Number(snakeValue);
	}
	const camelValue = record[camel];
	return Number.isFinite(camelValue) ? Number(camelValue) : null;
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
		const docId = readString(record, "doc_id", "docId");
		if (!docId) {
			continue;
		}
		entries.push({
			docId,
			chunkId: readString(record, "chunk_id", "chunkId"),
			score: readNumber(record, "score", "score"),
			collection: readString(record, "collection", "collection"),
			sourceTitle: readString(record, "source_title", "sourceTitle"),
			canonicalSourceId: readString(record, "canonical_source_id", "canonicalSourceId"),
			canonicalSourceTitle: readString(record, "canonical_source_title", "canonicalSourceTitle"),
			sourceUnitKind: readString(record, "source_unit_kind", "sourceUnitKind"),
			sourceUnitKey: readString(record, "source_unit_key", "sourceUnitKey"),
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
	const evidence = record ? getRecord(record.evidence) : null;
	return summarizeObservedSources(evidence?.sources, limit);
}
