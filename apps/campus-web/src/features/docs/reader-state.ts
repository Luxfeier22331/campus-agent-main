export interface ReaderLocationState {
	anchor: string | null;
	highlightRootUnitIds: string[];
}

export interface VersionReaderHrefInput {
	collection: string;
	corpus: string;
	documentSlug: string;
	isCurrent: boolean;
	readerState: ReaderLocationState;
	routeSlug: string;
	versionSlug: string;
}

export function parseReaderLocationState(rawUrl: string): ReaderLocationState {
	const url = new URL(rawUrl, "https://campus.muc.wiki");
	const rawAnchor = url.hash.slice(1);
	const highlight = url.searchParams.get("hl") ?? "";
	return {
		anchor: rawAnchor ? decodeURIComponent(rawAnchor) : null,
		highlightRootUnitIds: parseHighlightRootUnitIds(highlight),
	};
}

export function buildVersionReaderHref(input: VersionReaderHrefInput): string {
	const basePath = `/docs/${input.corpus}/${input.collection}/${input.routeSlug}`;
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
