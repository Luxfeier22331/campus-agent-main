export interface DocsVersionOrder {
	kind: "ordinal" | "year";
	value: number;
}

export function parseDocsVersionOrder(versionSlug: string): DocsVersionOrder {
	if (/^\d{4}$/u.test(versionSlug)) {
		const value = Number(versionSlug);
		if (value > 0) {
			return { kind: "year", value };
		}
	}
	if (/^[1-9]\d*$/u.test(versionSlug)) {
		return { kind: "ordinal", value: Number(versionSlug) };
	}
	throw new Error(`version slug must be a year or positive ordinal: ${versionSlug}`);
}

export function compareDocsVersionSlugs(left: string, right: string): number {
	const leftOrder = parseDocsVersionOrder(left);
	const rightOrder = parseDocsVersionOrder(right);
	if (leftOrder.kind !== rightOrder.kind) {
		throw new Error(`document versions mix year and ordinal slugs: ${left}, ${right}`);
	}
	return leftOrder.value - rightOrder.value || left.localeCompare(right);
}

export function formatDocsVersionLabel(versionSlug: string): string {
	const order = parseDocsVersionOrder(versionSlug);
	return order.kind === "year" ? `${versionSlug} 年版` : `第 ${order.value} 版`;
}
