export function resolveDocsRedirect(
	pathname: string,
	redirects: ReadonlyArray<{ fromPath: string; toPath: string }>,
): string | null {
	const normalized = normalizeDocsRedirectPath(pathname);
	return redirects.find((redirect) => redirect.fromPath === normalized)?.toPath ?? null;
}

export function normalizeDocsRedirectPath(pathname: string): string {
	let normalized = pathname;
	if (normalized.endsWith("/index.html")) {
		normalized = normalized.slice(0, -"/index.html".length);
	} else if (normalized.endsWith(".html")) {
		normalized = normalized.slice(0, -".html".length);
	}
	return normalized.replace(/\/+$/u, "") || "/";
}

export function isDocsDocumentPath(pathname: string): boolean {
	const segments = pathname.split("/").filter(Boolean);
	if (segments[0] !== "docs") {
		return false;
	}
	return segments.length === 4 || (segments.length === 6 && segments[4] === "v");
}
