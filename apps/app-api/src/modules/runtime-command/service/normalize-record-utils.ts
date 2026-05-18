export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function recordString(
	record: Record<string, unknown>,
	snakeCaseKey: string,
	camelCaseKey: string,
): string | null {
	return normalizeOptionalString(
		snakeCaseKey in record ? record[snakeCaseKey] : record[camelCaseKey],
	);
}

export function recordNumber(
	record: Record<string, unknown>,
	snakeCaseKey: string,
	camelCaseKey: string,
): number | null {
	const value = snakeCaseKey in record ? record[snakeCaseKey] : record[camelCaseKey];
	return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export function recordStringArray(
	record: Record<string, unknown>,
	snakeCaseKey: string,
	camelCaseKey: string,
): string[] {
	const value = snakeCaseKey in record ? record[snakeCaseKey] : record[camelCaseKey];
	return normalizeStringArray(value);
}

export function recordObjectArray(
	record: Record<string, unknown>,
	snakeCaseKey: string,
	camelCaseKey: string,
): Record<string, unknown>[] {
	const value = snakeCaseKey in record ? record[snakeCaseKey] : record[camelCaseKey];
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is Record<string, unknown> => isRecord(item));
}

export function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((item) => normalizeOptionalString(item))
		.filter((item): item is string => item !== null);
}

export function dedupeStable(values: string[]): string[] {
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const value of values) {
		if (seen.has(value)) {
			continue;
		}
		seen.add(value);
		deduped.push(value);
	}
	return deduped;
}
