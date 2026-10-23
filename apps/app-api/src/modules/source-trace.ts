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
