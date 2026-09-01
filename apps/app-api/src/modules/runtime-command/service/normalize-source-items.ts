import type { ChatMessageStructuredPart, ChatSourceItem } from "../../chat";
import type { ToolExecutionResponse } from "../../integration";
import { normalizeDocsReaderPath } from "../../source-trace";
import {
	dedupeStable,
	isRecord,
	normalizeOptionalString,
	recordNumber,
	recordString,
	recordStringArray,
} from "./normalize-record-utils";

function buildSourceCardHref(input: {
	anchor: string | null;
	basePath: string;
	rootUnitIds: string[];
}): string {
	const highlight = input.rootUnitIds.join(",");
	const query = highlight ? `?hl=${encodeURIComponent(highlight)}` : "";
	const hash = input.anchor ? `#${encodeURIComponent(input.anchor)}` : "";
	return `${input.basePath}${query}${hash}`;
}

function collectionLabel(basePath: string): string {
	if (basePath.startsWith("/docs/curriculum/")) {
		return "培养方案";
	}
	if (basePath.startsWith("/docs/regulations/student_rules/")) {
		return "学生手册";
	}
	return "公开文档";
}

function normalizeSnippet(value: unknown): string | null {
	const snippet = normalizeOptionalString(value);
	if (!snippet) {
		return null;
	}
	return snippet.length <= 180 ? snippet : `${snippet.slice(0, 179)}…`;
}

function parseSectionRef(value: string): { anchor: string | null; basePath: string } | null {
	const hashIndex = value.indexOf("#");
	const basePath = normalizeDocsReaderPath(hashIndex >= 0 ? value.slice(0, hashIndex) : value);
	if (!basePath) {
		return null;
	}
	const rawAnchor = hashIndex >= 0 ? value.slice(hashIndex + 1).trim() : "";
	if (!rawAnchor) {
		return { anchor: null, basePath };
	}
	try {
		return { anchor: decodeURIComponent(rawAnchor), basePath };
	} catch {
		return null;
	}
}

interface NormalizedSourceBase {
	citationIndexes: number[];
	identityKey: string;
	primaryHref: string;
	snippet: string | null;
	title: string;
}

interface NormalizedCampusSource extends NormalizedSourceBase {
	anchor: string | null;
	basePath: string;
	kind: "campus_document";
	rootUnitIds: string[];
	sectionTitle: string;
	versionSlug: string;
}

interface NormalizedWebSource extends NormalizedSourceBase {
	hostname: string;
	kind: "web_page";
}

type NormalizedSource = NormalizedCampusSource | NormalizedWebSource;

function versionSlugFromReaderPath(basePath: string): string | null {
	const segments = basePath.split("/").filter(Boolean);
	if (segments.length !== 6 || segments[0] !== "docs" || segments[4] !== "v") {
		return null;
	}
	try {
		return decodeURIComponent(segments[5] ?? "");
	} catch {
		return null;
	}
}

function normalizeSource(source: unknown): NormalizedSource | null {
	if (!isRecord(source)) {
		return null;
	}
	const title = recordString(source, "title", "title");
	const kind = recordString(source, "kind", "kind");
	const citationIndex = recordNumber(source, "citation_index", "citationIndex");
	const citationHref = recordString(source, "citation_href", "citationHref");
	const sectionRef = citationHref ?? recordString(source, "section_ref", "sectionRef");
	const versionSlug = recordString(source, "version_slug", "versionSlug");
	const parsedRef = sectionRef ? parseSectionRef(sectionRef) : null;
	if (!(title && citationIndex !== null) || citationIndex > 10) {
		return null;
	}

	if (kind === "campus_document") {
		const rootUnitIds = dedupeStable(recordStringArray(source, "root_unit_ids", "rootUnitIds"));
		if (!(parsedRef && versionSlug)) {
			return null;
		}
		if (
			!/^[1-9]\d*$/u.test(versionSlug) ||
			versionSlugFromReaderPath(parsedRef.basePath) !== versionSlug
		) {
			return null;
		}
		return {
			anchor: parsedRef.anchor,
			basePath: parsedRef.basePath,
			citationIndexes: [citationIndex],
			identityKey: `campus:${parsedRef.basePath}\u0000${parsedRef.anchor ?? ""}`,
			kind: "campus_document",
			primaryHref: buildSourceCardHref({
				anchor: parsedRef.anchor,
				basePath: parsedRef.basePath,
				rootUnitIds,
			}),
			rootUnitIds,
			sectionTitle: recordString(source, "section_title", "sectionTitle") ?? "",
			snippet: normalizeSnippet(source.snippet),
			title,
			versionSlug,
		};
	}

	if (kind === "web_page") {
		const url = recordString(source, "url", "url");
		const webHref = citationHref ?? url;
		const normalizedUrl = normalizeWebUrl(url);
		const normalizedCitationHref = normalizeWebUrl(webHref);
		const hostname = recordString(source, "hostname", "hostname");
		if (
			!(normalizedUrl && normalizedCitationHref && hostname) ||
			hostname.toLowerCase() !== normalizedUrl.hostname
		) {
			return null;
		}
		return {
			citationIndexes: [citationIndex],
			hostname: normalizedUrl.hostname,
			identityKey: `web:${normalizedUrl.href}`,
			kind: "web_page",
			primaryHref: normalizedCitationHref.href,
			snippet: normalizeSnippet(source.snippet),
			title,
		};
	}

	return null;
}

function sourceItemFromNormalized(source: NormalizedSource): ChatSourceItem {
	if (source.kind === "web_page") {
		return {
			citationIndexes: source.citationIndexes,
			hostname: source.hostname,
			kind: "web_page",
			primaryAction: {
				label: "打开网页",
				href: source.primaryHref,
				external: true,
				disabledReason: null,
			},
			snippet: source.snippet,
			title: source.title,
		};
	}

	return {
		citationIndexes: source.citationIndexes,
		kind: "campus_document",
		title: source.title,
		snippet: source.snippet,
		primaryAction: {
			label: "查看文档",
			href: source.primaryHref,
			external: false,
			disabledReason: null,
		},
		sectionTitle: source.sectionTitle,
		collectionLabel: collectionLabel(source.basePath),
		versionSlug: source.versionSlug,
	};
}

function normalizeWebUrl(value: string | null): URL | null {
	if (!value) {
		return null;
	}
	try {
		const parsed = new URL(value);
		if (
			(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
			!parsed.hostname ||
			parsed.username ||
			parsed.password
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

export function resultSources(result: unknown): unknown[] {
	if (!isRecord(result)) {
		return [];
	}
	return Array.isArray(result.sources) ? result.sources : [];
}

export function normalizeSourceItemsPart(input: {
	status: ToolExecutionResponse["status"];
	result: unknown;
}): ChatMessageStructuredPart[] {
	if (input.status !== "completed") {
		return [];
	}
	const normalizedSources: NormalizedSource[] = [];
	const sourcesByKey = new Map<string, NormalizedSource>();
	for (const [index, source] of resultSources(input.result).entries()) {
		const normalized = normalizeSource(source);
		if (!normalized) {
			throw new Error(`Execution source item ${index} is invalid.`);
		}
		const key = normalized.identityKey;
		const existing = sourcesByKey.get(key);
		if (existing) {
			existing.citationIndexes = dedupeStableNumbers([
				...existing.citationIndexes,
				...normalized.citationIndexes,
			]);
			if (existing.kind === "campus_document" && normalized.kind === "campus_document") {
				existing.rootUnitIds = dedupeStable([...existing.rootUnitIds, ...normalized.rootUnitIds]);
				existing.primaryHref = buildSourceCardHref({
					anchor: existing.anchor,
					basePath: existing.basePath,
					rootUnitIds: existing.rootUnitIds,
				});
			}
			continue;
		}
		sourcesByKey.set(key, normalized);
		normalizedSources.push(normalized);
	}
	const sourceItems = normalizedSources.map(sourceItemFromNormalized);
	return sourceItems.length > 0
		? [
				{
					type: "source_items",
					sourceItems,
				},
			]
		: [];
}

function dedupeStableNumbers(values: number[]): number[] {
	const seen = new Set<number>();
	const deduped: number[] = [];
	for (const value of values) {
		if (seen.has(value)) {
			continue;
		}
		seen.add(value);
		deduped.push(value);
	}
	return deduped;
}
