export function normalizeDocsSearchQuery(query: string): string {
	return query
		.normalize("NFKC")
		.replace(/[\u3000\s]+/gu, " ")
		.replace(/[，。、“”‘’；：！？（）《》【】,.!?;:()[\]{}"']/gu, "")
		.trim()
		.toLowerCase();
}
