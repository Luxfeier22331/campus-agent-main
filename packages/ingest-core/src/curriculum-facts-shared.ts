import { createHash } from "node:crypto";

import { load as loadHtml } from "cheerio";

import { canonicalJsonString } from "./core.ts";

export const POLICY_PROJECTION_VERSION = "phase1-authorization-projection-v1";
export const SOURCE_FAITHFUL_REVISION_TRACK = "source-faithful";
export const PDF_OCR_SOURCE_CHANNEL = "pdf_ocr";
export const MANUAL_CURATED_SOURCE_CHANNEL = "manual_curated";

export const SEMESTER_LABEL_TO_INDEX = {
	第一学期: "1",
	第二学期: "2",
	第三学期: "3",
	第四学期: "4",
	第五学期: "5",
	第六学期: "6",
	第七学期: "7",
	第八学期: "8",
	第九学期: "9",
	第十学期: "10",
} as const;

export const SEMESTER_INDEX_TO_LABEL = Object.fromEntries(
	Object.entries(SEMESTER_LABEL_TO_INDEX).map(([label, index]) => [index, label]),
) as Record<string, string>;

const EMPTY_TABLE_CELLS = new Set(["", "-", "—", "/", "／", "0"]);

export interface CurriculumRawAssetRecord {
	raw_asset_id: string;
	raw_version_id: string;
	raw_source_uri: string;
	object_key: string;
}

export interface CurriculumSplitManifestDocument {
	document_id: string;
	title: string;
	page_start: number;
	page_end: number;
	entitlement_groups?: readonly string[];
	visibility_scope?: string | null;
	visibility_level?: string | null;
	status?: string | null;
}

export interface CurriculumProjectionDocument {
	source_label: string;
	document_units_jsonl: string;
	metadata: Record<string, unknown>;
	import_source: string;
	revision_track: string;
	source_channel: string;
	is_current: boolean;
	corpus: string;
	collection: string;
	visibility_scope: string | null;
	status: string;
	raw_source_uri: string | null;
	raw_asset_id: string | null;
	raw_version_id: string | null;
	provider_response_object_key: string | null;
	additional_processed_object_keys: readonly string[];
	title: string;
	year: string | null;
}

export interface CurriculumProgramFamilyConfig {
	families: readonly CurriculumProgramFamilyConfigEntry[];
}

export interface CurriculumProgramFamilyConfigEntry {
	canonical_program_family_id: string;
	canonical_program_family_title: string;
	match_aliases?: readonly string[];
	mode: "direct_answer_family" | "clarify_first_family";
	source_title: string;
	member_program_ids?: readonly string[];
	member_program_titles?: readonly string[];
	answer_snippet: string;
	clarification_options?: readonly string[];
}

export function projectionDocument(input: {
	additionalProcessedObjectKeys: readonly string[];
	collection: string;
	corpus: string;
	importSource: string;
	providerResponseObjectKey: string | null;
	rawAssetRecord: CurriculumRawAssetRecord;
	row: Record<string, unknown>;
	sourceChannel: string;
	sourceLabel: string;
	status: string;
	title: string;
	visibilityScope: string | null;
	year: string | null;
}): CurriculumProjectionDocument {
	const metadata = metadataFromDocumentUnit(input.row);
	metadata.title = input.title;
	metadata.status = input.status;
	return {
		additional_processed_object_keys: input.additionalProcessedObjectKeys,
		collection: input.collection,
		corpus: input.corpus,
		document_units_jsonl: `${canonicalJsonString(input.row)}\n`,
		import_source: input.importSource,
		is_current: false,
		metadata,
		provider_response_object_key: input.providerResponseObjectKey,
		raw_asset_id: input.rawAssetRecord.raw_asset_id,
		raw_source_uri: input.rawAssetRecord.raw_source_uri,
		raw_version_id: input.rawAssetRecord.raw_version_id,
		revision_track: SOURCE_FAITHFUL_REVISION_TRACK,
		source_channel: input.sourceChannel,
		source_label: input.sourceLabel,
		status: input.status,
		title: input.title,
		visibility_scope: input.visibilityScope,
		year: input.year,
	};
}

export function authorizationRow(
	document: CurriculumSplitManifestDocument,
): Record<string, unknown> {
	return {
		entitlement_groups: resolvedEntitlementGroups(document),
		visibility_scope: resolvedVisibilityScope(document),
		visibility_level: resolvedVisibilityLevel(document),
		policy_projection_version: POLICY_PROJECTION_VERSION,
	};
}

export function extractTableRows(row: Record<string, unknown>): string[][] {
	const text = rowText(row);
	const html = optionalText(row.html) ?? (text.toLowerCase().includes("<table") ? text : null);
	if (Array.isArray(row.table_cells) && row.table_cells.length > 0) {
		const fromCells = buildDenseRowsFromCellRecords(row.table_cells);
		if (fromCells.length > 0) {
			return fromCells;
		}
	}
	if (html) {
		const fromHtml = buildDenseRowsFromHtml(html);
		if (fromHtml.length > 0) {
			return fromHtml;
		}
	}
	return extractPipeDelimitedRows(text);
}

export function buildDigestVersionId(value: string, prefix: string): string {
	return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

export function rowWithinDocument(
	row: Record<string, unknown>,
	document: CurriculumSplitManifestDocument,
): boolean {
	const start = rowPageStart(row, 0);
	const end = rowPageEnd(row, start);
	return start >= document.page_start && end <= document.page_end;
}

export function rowText(row: Record<string, unknown>): string {
	return optionalText(row.clean_text) ?? optionalText(row.text_normalized) ?? "";
}

export function rowPageStart(row: Record<string, unknown>, defaultValue: number): number {
	const value = integerValue(row.page_start);
	return value && value > 0 ? value : defaultValue;
}

export function rowPageEnd(row: Record<string, unknown>, defaultValue: number): number {
	const value = integerValue(row.page_end);
	return value && value > 0 ? value : defaultValue;
}

export function firstVisibilityScope(
	documents: readonly CurriculumSplitManifestDocument[],
): string | null {
	for (const document of documents) {
		const scope = resolvedVisibilityScope(document);
		if (scope) {
			return scope;
		}
	}
	return null;
}

export function firstVisibilityLevel(
	documents: readonly CurriculumSplitManifestDocument[],
): string {
	for (const document of documents) {
		const level = optionalText(document.visibility_level);
		if (level) {
			return level;
		}
	}
	return "public";
}

export function unionEntitlementGroups(
	documents: readonly CurriculumSplitManifestDocument[],
): string[] {
	return unique(documents.flatMap((document) => resolvedEntitlementGroups(document)));
}

export function resolvedEntitlementGroups(document: CurriculumSplitManifestDocument): string[] {
	return unique((document.entitlement_groups ?? []).map(normalizeText).filter(Boolean));
}

export function resolvedVisibilityScope(document: CurriculumSplitManifestDocument): string | null {
	return optionalText(document.visibility_scope);
}

export function resolvedVisibilityLevel(document: CurriculumSplitManifestDocument): string {
	return (
		optionalText(document.visibility_level) ??
		(resolvedEntitlementGroups(document).length > 0 ? "restricted" : "public")
	);
}

export function sourceStatus(document: CurriculumSplitManifestDocument): string {
	return optionalText(document.status) ?? "active";
}

export function cellHasValue(value: string): boolean {
	return !EMPTY_TABLE_CELLS.has(normalizeText(value));
}

export function inferYear(value: string): string | null {
	return /(?<!\d)((?:19|20)\d{2})(?!\d)/u.exec(value)?.[1] ?? null;
}

export function normalizeText(value: string): string {
	return value.trim().replace(/\s+/gu, " ");
}

export function optionalText(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function ensureFinalPeriod(value: string): string {
	return value.endsWith("。") ? value : `${value}。`;
}

export function stripFinalPeriod(value: string): string {
	return value.endsWith("。") ? value.slice(0, -1) : value;
}

export function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function metadataFromDocumentUnit(row: Record<string, unknown>): Record<string, unknown> {
	const source = isRecord(row.source) ? row.source : {};
	const nestedMetadata = isRecord(row.metadata) ? row.metadata : {};
	return {
		document_id: row.doc_id,
		version_id: row.version_id,
		revision_track: SOURCE_FAITHFUL_REVISION_TRACK,
		source_url: row.source_url,
		source_md: row.source_md ?? null,
		source_id: source.id,
		source_pdf: row.source_pdf,
		raw_page_start: row.page_start,
		raw_page_end: row.page_end,
		semantic_content_hash: nestedMetadata.semantic_content_hash ?? null,
		title: nestedMetadata.title ?? null,
		page_family: nestedMetadata.page_family ?? null,
		serving_intent: nestedMetadata.serving_intent ?? null,
		content_role: nestedMetadata.content_role ?? null,
		entitlement_groups: row.entitlement_groups ?? [],
		visibility_scope: row.visibility_scope ?? null,
		visibility_level: row.visibility_level ?? "public",
		policy_projection_version: row.policy_projection_version ?? POLICY_PROJECTION_VERSION,
	};
}

function buildDenseRowsFromCellRecords(value: readonly unknown[]): string[][] {
	const cells = value.filter(isRecord);
	const rowCount = Math.max(0, ...cells.map((cell) => integerValue(cell.row) ?? 0));
	const columnCount = Math.max(
		0,
		...cells.map((cell) => {
			const col = integerValue(cell.col) ?? 0;
			const colspan = integerValue(cell.colspan) ?? 1;
			return col + Math.max(colspan - 1, 0);
		}),
	);
	if (rowCount <= 0 || columnCount <= 0) {
		return [];
	}
	const grid = Array.from({ length: rowCount }, () =>
		Array.from({ length: columnCount }, () => ""),
	);
	for (const cell of [...cells].sort(
		(left, right) =>
			(integerValue(left.row) ?? 0) - (integerValue(right.row) ?? 0) ||
			(integerValue(left.col) ?? 0) - (integerValue(right.col) ?? 0),
	)) {
		const rowIndex = (integerValue(cell.row) ?? 0) - 1;
		const columnIndex = (integerValue(cell.col) ?? 0) - 1;
		if (rowIndex >= 0 && rowIndex < rowCount && columnIndex >= 0 && columnIndex < columnCount) {
			grid[rowIndex][columnIndex] = normalizeText(String(cell.text ?? ""));
		}
	}
	return normalizeDenseRows(grid);
}

function buildDenseRowsFromHtml(html: string): string[][] {
	const $ = loadHtml(html);
	const rows: string[][] = [];
	$("tr").each((_, rowElement) => {
		const row: string[] = [];
		$(rowElement)
			.find("td,th")
			.each((__, cellElement) => {
				row.push(normalizeText($(cellElement).text()));
			});
		rows.push(row);
	});
	return normalizeDenseRows(rows);
}

function extractPipeDelimitedRows(text: string): string[][] {
	return normalizeDenseRows(
		text
			.split(/\r?\n/gu)
			.filter((line) => line.includes("|"))
			.map((line) => line.split("|").map(normalizeText)),
	);
}

function normalizeDenseRows(rows: readonly (readonly string[])[]): string[][] {
	const width = Math.max(0, ...rows.map((row) => row.length));
	if (width <= 0) {
		return [];
	}
	return rows
		.map((row) => Array.from({ length: width }, (_, index) => normalizeText(row[index] ?? "")))
		.filter((row) => row.some(Boolean));
}

function integerValue(value: unknown): number | null {
	if (typeof value === "number" && Number.isInteger(value)) {
		return value;
	}
	if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
		return Number(value.trim());
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
