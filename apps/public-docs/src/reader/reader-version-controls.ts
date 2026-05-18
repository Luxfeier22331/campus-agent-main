export interface DocsVersionsResponse {
	versions: Array<{
		isCurrent: boolean;
		label: string;
		versionSlug: string;
	}>;
}

export interface DocsVersionControlRequest {
	collection: string;
	corpus: string;
	documentSlug: string;
	fetchImplementation?: typeof fetch;
}

export async function fetchDocsVersionControlPayload({
	collection,
	corpus,
	documentSlug,
	fetchImplementation = fetch,
}: DocsVersionControlRequest): Promise<DocsVersionsResponse> {
	const response = await fetchImplementation(
		`/api/docs/collections/${encodeURIComponent(corpus)}/${encodeURIComponent(
			collection,
		)}/documents/${encodeURIComponent(documentSlug)}/versions`,
		{ headers: { accept: "application/json" } },
	);
	if (!response.ok) {
		throw new Error(`Docs versions endpoint returned HTTP ${response.status}.`);
	}
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.includes("application/json")) {
		throw new Error("Docs versions endpoint returned a non-JSON response.");
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		throw new Error("Docs versions endpoint returned invalid JSON.", { cause: error });
	}
	if (!isDocsVersionsResponse(payload)) {
		throw new Error("Docs versions endpoint returned an invalid payload.");
	}
	return payload;
}

function isDocsVersionsResponse(value: unknown): value is DocsVersionsResponse {
	return (
		typeof value === "object" &&
		value !== null &&
		"versions" in value &&
		Array.isArray(value.versions) &&
		value.versions.every(isDocsVersion)
	);
}

function isDocsVersion(value: unknown): value is DocsVersionsResponse["versions"][number] {
	return (
		typeof value === "object" &&
		value !== null &&
		"isCurrent" in value &&
		typeof value.isCurrent === "boolean" &&
		"label" in value &&
		typeof value.label === "string" &&
		value.label.trim().length > 0 &&
		"versionSlug" in value &&
		typeof value.versionSlug === "string" &&
		value.versionSlug.trim().length > 0
	);
}
