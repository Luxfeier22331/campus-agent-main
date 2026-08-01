export function filterDocsByTitle<T extends { title: string }>(
	documents: readonly T[],
	query: string,
): T[] {
	const normalizedQuery = normalizeDocsTitleQuery(query);
	return normalizedQuery
		? documents.filter((document) =>
				normalizeDocsTitleQuery(document.title).includes(normalizedQuery),
			)
		: [...documents];
}

export function normalizeDocsTitleQuery(value: string): string {
	return value.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase("zh-CN");
}
