export interface ReaderLocationState {
	anchor: string | null;
	highlightRootUnitIds: string[];
}

export interface VersionReaderHrefInput {
	collection: string;
	corpus: string;
	documentSlug: string;
	isCurrent: boolean;
	routeSlug: string;
	versionSlug: string;
}

export function parseReaderLocationState(rawUrl: string): ReaderLocationState {
	const url = new URL(rawUrl, "https://campus.muc.wiki");
	const rawAnchor = url.hash.slice(1);
	const highlight = url.searchParams.get("hl") ?? "";
	return {
		anchor: rawAnchor ? decodeReaderLocationPart(rawAnchor) : null,
		highlightRootUnitIds: parseHighlightRootUnitIds(highlight),
	};
}

export function buildVersionReaderHref(input: VersionReaderHrefInput): string {
	const basePath = `/docs/${input.corpus}/${input.collection}/${input.routeSlug}`;
	const versionPath = input.isCurrent
		? basePath
		: `${basePath}/v/${encodeURIComponent(input.versionSlug)}`;
	return versionPath;
}

function parseHighlightRootUnitIds(value: string): string[] {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean)
		.map(decodeReaderLocationPart)
		.filter((item): item is string => item !== null);
}

function decodeReaderLocationPart(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}
