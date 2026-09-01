export interface ReaderLocationState {
	anchor: string | null;
	highlightRootUnitIds: string[];
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
