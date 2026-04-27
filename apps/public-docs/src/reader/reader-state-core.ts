export interface ReaderState {
	anchor: string | null;
	highlightRootUnitIds: string[];
}

export interface VersionReaderHrefInput {
	collection: string;
	corpus: string;
	documentSlug: string;
	isCurrent: boolean;
	readerState: ReaderState;
	versionSlug: string;
}

export function parseReaderLocationState(rawUrl: string): ReaderState {
	const url = new URL(rawUrl, "https://docs.local");
	const legacyHashQueryIndex = url.hash.indexOf("?");
	const rawAnchor =
		legacyHashQueryIndex >= 0 ? url.hash.slice(1, legacyHashQueryIndex) : url.hash.slice(1);
	const legacySearch =
		legacyHashQueryIndex >= 0
			? new URLSearchParams(url.hash.slice(legacyHashQueryIndex + 1))
			: null;
	const highlight = url.searchParams.get("hl") ?? legacySearch?.get("hl") ?? "";
	return {
		anchor: rawAnchor ? decodeURIComponent(rawAnchor) : null,
		highlightRootUnitIds: parseHighlightRootUnitIds(highlight),
	};
}

export function buildVersionReaderHref(input: VersionReaderHrefInput): string {
	const basePath = `/docs/${input.corpus}/${input.collection}/${input.documentSlug}`;
	const versionPath = input.isCurrent
		? basePath
		: `${basePath}/v/${encodeURIComponent(input.versionSlug)}`;
	const highlight = input.readerState.highlightRootUnitIds
		.map((item) => item.trim())
		.filter(Boolean)
		.map(encodeURIComponent)
		.join(",");
	const query = highlight ? `?hl=${highlight}` : "";
	const hash = input.readerState.anchor ? `#${encodeURIComponent(input.readerState.anchor)}` : "";
	return `${versionPath}${query}${hash}`;
}

function parseHighlightRootUnitIds(value: string): string[] {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean)
		.map(decodeURIComponent);
}
