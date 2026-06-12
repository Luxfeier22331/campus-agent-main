import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function writePagefindSearchUnits(input) {
	const currentPublicEntries = input.entries.filter(
		(entry) => entry.deliveryMode === "public_static_asset" && entry.isCurrent,
	);
	const publicCurrentVersionIds = new Set(
		currentPublicEntries.map((entry) => entry.versionId).filter(Boolean),
	);
	const units = resolvePagefindSearchUnits({
		manifest: input.manifest,
		versionIds: publicCurrentVersionIds,
	}).sort((left, right) =>
		`${left.corpus}/${left.collection}/${left.documentSlug}/${left.versionSlug}/${left.anchor}`.localeCompare(
			`${right.corpus}/${right.collection}/${right.documentSlug}/${right.versionSlug}/${right.anchor}`,
		),
	);
	writeText(
		resolve(input.targetRoot, "pagefind", "campus-docs-search-units.json"),
		formatJson({
			generatedAt: input.manifest.generatedAt ?? null,
			schemaVersion: "campus_pagefind_search_units_v1",
			units,
		}),
	);
}

function resolvePagefindSearchUnits(input) {
	return input.manifest.searchUnits
		.filter((unit) => input.versionIds.has(unit.versionId))
		.map(normalizePagefindSearchUnit);
}

function normalizePagefindSearchUnit(unit) {
	return {
		anchor: requireString(unit.anchor, "searchUnits[].anchor"),
		canonicalUrl: buildCurrentReaderCanonicalUrl(
			requireString(unit.canonicalUrl, "searchUnits[].canonicalUrl"),
		),
		collection: requireString(unit.collection, "searchUnits[].collection"),
		corpus: requireString(unit.corpus, "searchUnits[].corpus"),
		docId: requireString(unit.docId, "searchUnits[].docId"),
		documentSlug: requireString(unit.documentSlug, "searchUnits[].documentSlug"),
		documentTitle: requireString(unit.documentTitle, "searchUnits[].documentTitle"),
		highlightRootUnitIds: stringArray(unit.highlightRootUnitIds),
		searchUnitId: requireString(unit.searchUnitId, "searchUnits[].searchUnitId"),
		snippet: requireString(unit.snippet, "searchUnits[].snippet"),
		title: requireString(unit.title, "searchUnits[].title"),
		versionId: requireString(unit.versionId, "searchUnits[].versionId"),
		versionSlug: requireString(unit.versionSlug, "searchUnits[].versionSlug"),
	};
}

function buildCurrentReaderCanonicalUrl(canonicalUrl) {
	return canonicalUrl.split("#", 1)[0].split("?", 1)[0].replace(/\/$/u, "");
}

function requireString(value, name) {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`campus docs reader manifest entry requires ${name}`);
	}
	return value.trim();
}

function stringArray(value) {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((item) => requireString(item, "string array item"));
}

function writeText(path, content) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
}

function formatJson(value) {
	return `${JSON.stringify(value, undefined, "\t")}\n`;
}
