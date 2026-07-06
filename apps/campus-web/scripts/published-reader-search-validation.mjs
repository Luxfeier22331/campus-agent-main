import { resolvePublishedReaderSourceObjectKey } from "./published-reader-assets.mjs";
import { normalizeSearchUnit } from "./published-reader-manifest.mjs";

export function buildSearchUnitsByVersionId(searchUnits) {
	const byVersionId = new Map();
	const seenSearchUnitIds = new Set();
	for (const rawUnit of searchUnits) {
		const unit = normalizeSearchUnit(rawUnit);
		if (seenSearchUnitIds.has(unit.searchUnitId)) {
			throw new Error(`duplicate published reader searchUnitId: ${unit.searchUnitId}`);
		}
		seenSearchUnitIds.add(unit.searchUnitId);
		byVersionId.set(unit.versionId, [...(byVersionId.get(unit.versionId) ?? []), unit]);
	}
	for (const [versionId, units] of byVersionId) {
		byVersionId.set(versionId, units.sort(compareSearchUnit));
	}
	return byVersionId;
}

export async function assertProtectedSearchUnitsReferenceReader(input) {
	for (const entry of input.entries) {
		if (entry.deliveryMode !== "gated_asset" || !entry.isCurrent) {
			continue;
		}
		if (!entry.versionId) {
			throw new Error(`protected search index requires versionId: ${entry.documentSlug}`);
		}
		const searchUnits = input.searchUnitsByVersionId.get(entry.versionId);
		if (!searchUnits) {
			throw new Error(`missing protected search units for version: ${entry.versionId}`);
		}
		const readerRefs = await readReaderRefs({ client: input.client, entry });
		for (const unit of searchUnits) {
			assertSearchUnitMatchesEntry({ entry, unit });
			assertSearchUnitAnchorExists({ entry, readerRefs, unit });
			assertSearchUnitHighlightRootsExist({ entry, readerRefs, unit });
			assertSearchUnitCanonicalUrlMatchesEntry({ entry, unit });
		}
	}
}

export function buildProtectedSearchEntry(input) {
	assertSearchUnitMatchesEntry({ entry: input.entry, unit: input.unit });
	const sectionTitle = input.unit.title;
	return {
		anchor: input.unit.anchor,
		canonicalUrl: buildReaderCanonicalUrl(input.entry),
		collection: input.entry.collection,
		collectionLabel: input.resolveCollectionLabel(input.entry),
		corpus: input.entry.corpus,
		documentSlug: input.entry.documentSlug,
		documentTitle: input.unit.documentTitle,
		highlightRootUnitIds: input.unit.highlightRootUnitIds,
		searchText: [input.unit.documentTitle, sectionTitle, input.unit.snippet].join(" "),
		searchUnitId: input.unit.searchUnitId,
		sectionTitle,
		snippet: input.unit.snippet,
		versionSlug: input.entry.versionSlug,
	};
}

function assertSearchUnitAnchorExists(input) {
	if (!input.readerRefs.anchors.has(input.unit.anchor)) {
		throw new Error(
			`protected search unit anchor does not exist in reader asset: ${input.entry.documentSlug}#${input.unit.anchor}`,
		);
	}
}

function assertSearchUnitHighlightRootsExist(input) {
	for (const rootUnitId of input.unit.highlightRootUnitIds) {
		if (!input.readerRefs.rootUnitIds.has(rootUnitId)) {
			throw new Error(
				`protected search unit highlight root does not exist in reader asset: ${input.entry.documentSlug}#${rootUnitId}`,
			);
		}
	}
}

function assertSearchUnitCanonicalUrlMatchesEntry(input) {
	const url = parseSearchUnitCanonicalUrl(input.unit.canonicalUrl);
	const expectedPath = buildReaderCanonicalUrl(input.entry);
	if (url.pathname !== expectedPath) {
		throw new Error(
			`protected search unit canonicalUrl does not match reader route: ${input.unit.searchUnitId}`,
		);
	}
	if (url.hash && decodeURIComponent(url.hash.slice(1)) !== input.unit.anchor) {
		throw new Error(
			`protected search unit canonicalUrl hash does not match anchor: ${input.unit.searchUnitId}`,
		);
	}
}

function parseSearchUnitCanonicalUrl(value) {
	if (!value.startsWith("/")) {
		throw new Error("protected search unit canonicalUrl must be a docs reader path");
	}
	const url = new URL(value, "https://docs.local");
	if (url.origin !== "https://docs.local" || url.search) {
		throw new Error("protected search unit canonicalUrl must be a docs reader path");
	}
	return url;
}

async function readReaderRefs(input) {
	const sourceObject = resolvePublishedReaderSourceObjectKey(input.entry, "reader");
	const reader = JSON.parse(await input.client.readTextObject({ key: sourceObject }));
	const anchors = new Set();
	const rootUnitIds = new Set();
	for (const section of Array.isArray(reader.sections) ? reader.sections : []) {
		const anchor = typeof section?.anchor === "string" ? section.anchor.trim() : "";
		if (anchor) {
			anchors.add(anchor);
		}
		for (const block of Array.isArray(section?.blocks) ? section.blocks : []) {
			const rootUnitId = typeof block?.rootUnitId === "string" ? block.rootUnitId.trim() : "";
			if (rootUnitId) {
				rootUnitIds.add(rootUnitId);
			}
		}
	}
	return { anchors, rootUnitIds };
}

function assertSearchUnitMatchesEntry(input) {
	const pairs = [
		["corpus", input.unit.corpus, input.entry.corpus],
		["collection", input.unit.collection, input.entry.collection],
		["documentSlug", input.unit.documentSlug, input.entry.documentSlug],
		["versionSlug", input.unit.versionSlug, input.entry.versionSlug],
	];
	for (const [label, actual, expected] of pairs) {
		if (actual !== expected) {
			throw new Error(`protected search unit ${label} does not match release entry`);
		}
	}
}

function buildReaderCanonicalUrl(entry) {
	return `/docs/${entry.corpus}/${entry.collection}/${entry.routeSlug}`;
}

function compareSearchUnit(left, right) {
	return (
		left.documentSlug.localeCompare(right.documentSlug) ||
		left.versionSlug.localeCompare(right.versionSlug) ||
		left.anchor.localeCompare(right.anchor) ||
		left.searchUnitId.localeCompare(right.searchUnitId)
	);
}
