export function normalizeDocsTitleQuery(value: string): string {
	return value.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase("zh-CN");
}
