export interface StyleDevLocation {
	storyId: string | null;
	variantId: string | null;
}

export function parseStyleDevHash(hash: string): StyleDevLocation {
	const raw = hash.replace(/^#/u, "").trim();
	if (!raw || raw === "overview") {
		return { storyId: null, variantId: null };
	}
	const separator = raw.indexOf("/");
	const rawStoryId = separator === -1 ? raw : raw.slice(0, separator);
	const rawVariantId = separator === -1 ? "" : raw.slice(separator + 1);
	return {
		storyId: decodeURIComponent(rawStoryId),
		variantId: rawVariantId ? decodeURIComponent(rawVariantId) : null,
	};
}

export function buildStyleDevHash(storyId: string | null, variantId?: string | null): string {
	if (!storyId) {
		return "#overview";
	}
	return `#${encodeURIComponent(storyId)}${variantId ? `/${encodeURIComponent(variantId)}` : ""}`;
}
