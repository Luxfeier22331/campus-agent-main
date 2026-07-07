import { createHash } from "node:crypto";
import { posix as pathPosix } from "node:path";

import { z } from "zod";

import { buildDocumentArtifactKey } from "./artifacts.ts";
import {
	encodeCanonicalJson,
	formatZodIssues,
	parseJsonObjectLinesBytes,
	parseOptionalText,
	sha256Hex,
} from "./core.ts";

const READER_SCHEMA_VERSION = "canonical_document_reader_v1";
const CORE_READER_ASSET_FILENAMES = [
	"reader.json",
	"outline.json",
	"meta.json",
	"asset-manifest.json",
] as const;
const CORE_ASSET_FILE_SET = new Set<string>(CORE_READER_ASSET_FILENAMES);
const COURSE_MAPS_FILENAME = "course-maps.json";
const COURSE_MAPS_DIRECTORY = "course-maps";
const COURSE_MAPS_SURFACE_SCHEMA_VERSION = "curriculum_course_map_docs_surface_v2";

export type DocumentReaderDeliveryMode = "public_static_asset" | "gated_asset";

export interface DocumentReaderRegistryRecord {
	canonical_markdown_object_key?: string | null;
	collection: string;
	content_hash?: string | null;
	corpus: string;
	document_id: string;
	document_units_object_key?: string | null;
	effective_date?: string | null;
	embedding_model?: string | null;
	entitlement_groups?: readonly string[] | null;
	import_source?: string | null;
	ingestion_timestamp: string;
	is_current?: boolean | null;
	parser_version?: string | null;
	published_date?: string | null;
	revision_track: string;
	source_channel?: string | null;
	source_uri: string;
	status?: string | null;
	version_id: string;
	visibility_level?: string | null;
	visibility_scope?: string | null;
}

export interface DocumentReaderAssetPackage {
	assets: Record<string, Uint8Array>;
}

export interface DocumentReaderPublishEntry {
	canonicalUrl: string;
	collection: string;
	corpus: string;
	deliveryMode: DocumentReaderDeliveryMode;
	docId: string;
	documentSlug: string;
	sourceObjects: Record<string, string>;
	targetObjects: Record<string, string>;
	title: string;
	updatedAt: string;
	versionId: string;
	versionSlug: string;
}

export interface PublicDocsSyncManifest {
	entries: DocumentReaderPublishEntry[];
	generatedAt: string;
	surface: "public_docs";
}

interface StructuredUnit {
	anchor: Record<string, unknown>;
	metadata: Record<string, unknown>;
	rootUnitId: string;
	sourceChunkId: string | null;
	text: string;
	unitIndex: number;
	unitType: string;
}

const DocumentReaderRegistryRecordSchema = z
	.object({
		canonical_markdown_object_key: z.string().trim().min(1).nullable().optional(),
		collection: z.string().trim().min(1),
		content_hash: z.string().trim().min(1).nullable().optional(),
		corpus: z.string().trim().min(1),
		document_id: z.string().trim().min(1),
		document_units_object_key: z.string().trim().min(1).nullable().optional(),
		effective_date: z.string().trim().min(1).nullable().optional(),
		embedding_model: z.string().trim().min(1).nullable().optional(),
		entitlement_groups: z.array(z.string()).readonly().nullable().optional(),
		import_source: z.string().trim().min(1).nullable().optional(),
		ingestion_timestamp: z.string().trim().min(1),
		is_current: z.boolean().nullable().optional(),
		parser_version: z.string().trim().min(1).nullable().optional(),
		published_date: z.string().trim().min(1).nullable().optional(),
		revision_track: z.string().trim().min(1),
		source_channel: z.string().trim().min(1).nullable().optional(),
		source_uri: z.string().trim().min(1),
		status: z.string().trim().min(1).nullable().optional(),
		version_id: z.string().trim().min(1),
		visibility_level: z.string().trim().min(1).nullable().optional(),
		visibility_scope: z.string().trim().min(1).nullable().optional(),
	})
	.passthrough();

const AnchorSchema = z
	.record(z.string(), z.unknown())
	.transform((value): Record<string, unknown> => ({ ...value }));
const DocumentUnitSchema = z
	.object({
		anchor: AnchorSchema.default({}),
		chunk_id: z.string().trim().min(1).nullable().optional(),
		clean_text: z.string().optional(),
		doc_id: z.string().trim().min(1),
		metadata: z.record(z.string(), z.unknown()).default({}),
		root_unit_id: z.string().trim().min(1).nullable().optional(),
		text: z.string().optional(),
		unit_type: z.string().trim().min(1).default("paragraph"),
		version_id: z.string().trim().min(1),
	})
	.passthrough();

const CourseMapNodeSchema = z
	.object({
		category_label: z.string().optional().default(""),
		node_id: z.string().trim().min(1),
		node_label: z.string().trim().min(1),
		stage_id: z.string().optional().default(""),
		stage_label: z.string().optional().default(""),
	})
	.passthrough();
const CourseMapEdgeSchema = z
	.object({
		edge_id: z.string().trim().min(1),
		source_label: z.string().trim().min(1),
		source_node_id: z.string().trim().min(1),
		target_label: z.string().trim().min(1),
		target_node_id: z.string().trim().min(1),
	})
	.passthrough();
const CourseMapBlockSchema = z
	.object({
		blockId: z.string().trim().min(1),
		displayStageLabels: z.array(z.string()).default([]),
		edges: z.array(CourseMapEdgeSchema).default([]),
		extractionNotes: z.array(z.string()).default([]),
		imageObjectKey: z.string().trim().min(1),
		mapIndex: z.number().int().positive(),
		nodes: z.array(CourseMapNodeSchema).default([]),
		pageNumber: z.number().int().positive(),
		parentHeadingHint: z.string().default(""),
		regionBBoxProvider: z.tuple([z.number(), z.number(), z.number(), z.number()]),
		rowId: z.string().trim().min(1),
		status: z.enum(["ready", "partial", "failed"]),
		title: z.string().trim().min(1),
		titleConfidence: z.enum(["visible", "partial", "absent"]),
	})
	.passthrough();
const CourseMapSurfaceSchema = z
	.object({
		blocks: z.array(CourseMapBlockSchema).default([]),
		documentId: z.string().trim().min(1),
		documentTitle: z.string().trim().min(1),
		generatedAt: z.string().trim().min(1),
		rawAssetId: z.string().trim().min(1),
		rawVersionId: z.string().trim().min(1),
		schemaVersion: z.literal(COURSE_MAPS_SURFACE_SCHEMA_VERSION),
	})
	.passthrough();

export function buildDocumentReaderAssetPackage(input: {
	canonicalMarkdown: string | Uint8Array;
	courseMapImageObjects?: Record<string, Uint8Array>;
	courseMapsJson?: unknown;
	documentUnitsJsonl: readonly unknown[] | string | Uint8Array;
	record: DocumentReaderRegistryRecord;
}): DocumentReaderAssetPackage {
	const record = parseRecord(input.record);
	const units = parseStructuredUnits(input.documentUnitsJsonl, record);
	const title = resolveDocumentTitle({
		canonicalMarkdown: decodeUtf8(input.canonicalMarkdown),
		record,
		units,
	});
	const documentSlug = resolveDocumentSlug({ record, title });
	const versionSlug = resolveVersionSlug(record);
	const canonicalUrl = buildCanonicalUrl({
		collection: record.collection,
		corpus: record.corpus,
		documentSlug,
	});
	const readerUnits = units.filter((unit) => unit.unitType !== "table_unit");
	const assets: Record<string, Uint8Array> = {};
	const supplements: Array<{ kind: string; path: string }> = [];

	if (input.courseMapsJson !== undefined) {
		supplements.push({ kind: "course_maps", path: COURSE_MAPS_FILENAME });
		Object.assign(
			assets,
			buildCourseMapAssets({
				courseMapImageObjects: input.courseMapImageObjects ?? {},
				courseMapsJson: input.courseMapsJson,
				record,
			}),
		);
	}

	assets["reader.json"] = jsonBytes({
		document: {
			collection: record.collection,
			corpus: record.corpus,
			docId: record.document_id,
			documentSlug,
			title,
			versionId: record.version_id,
			versionSlug,
			visibility: resolveVisibility(record),
		},
		schemaVersion: READER_SCHEMA_VERSION,
		sections: buildReaderSections(readerUnits),
		supplements,
	});
	assets["outline.json"] = jsonBytes({
		docId: record.document_id,
		nodes: buildOutlineNodes(readerUnits),
		schemaVersion: READER_SCHEMA_VERSION,
	});
	assets["meta.json"] = jsonBytes({
		canonicalUrl,
		collection: record.collection,
		corpus: record.corpus,
		docId: record.document_id,
		documentSlug,
		resolvedVersion: {
			effectiveFrom: record.effective_date ?? null,
			isCurrent: Boolean(record.is_current),
			label: record.is_current ? "现行版" : "历史版本",
			versionId: record.version_id,
			versionSlug,
		},
		schemaVersion: READER_SCHEMA_VERSION,
		title,
		updatedAt: record.ingestion_timestamp,
		visibility: resolveVisibility(record),
	});
	assets["asset-manifest.json"] = jsonBytes(
		buildAssetManifest({
			assets,
			canonicalUrl,
			record,
		}),
	);
	return { assets };
}

export function buildDocumentReaderPublishEntry(input: {
	publishedAssetNames?: readonly string[];
	record: DocumentReaderRegistryRecord;
	title: string;
}): DocumentReaderPublishEntry {
	const record = parseRecord(input.record);
	const title = input.title.trim();
	if (!title) {
		throw new Error("title is required");
	}
	const documentSlug = resolveDocumentSlug({ record, title });
	const versionSlug = resolveVersionSlug(record);
	const deliveryMode =
		resolveVisibility(record) === "public" ? "public_static_asset" : "gated_asset";
	const staticRoot = deliveryMode === "public_static_asset" ? "_docs" : "_gated-docs";
	const targetPrefix = joinPath(
		staticRoot,
		record.corpus,
		record.collection,
		documentSlug,
		versionSlug,
	);
	const sourceObjects: Record<string, string> = {};
	const targetObjects: Record<string, string> = {};
	for (const assetName of input.publishedAssetNames ?? CORE_READER_ASSET_FILENAMES) {
		const normalizedAssetName = validateReaderAssetName(assetName);
		const [sourceLabel, targetLabel] = resolvePublishObjectLabels(normalizedAssetName);
		sourceObjects[sourceLabel] = buildReaderAssetKey({
			assetName: normalizedAssetName,
			record,
			title,
		});
		targetObjects[targetLabel] = joinPath(targetPrefix, normalizedAssetName);
	}
	return {
		canonicalUrl: buildCanonicalUrl({
			collection: record.collection,
			corpus: record.corpus,
			documentSlug,
		}),
		collection: record.collection,
		corpus: record.corpus,
		deliveryMode,
		docId: record.document_id,
		documentSlug,
		sourceObjects,
		targetObjects,
		title,
		updatedAt: record.ingestion_timestamp,
		versionId: record.version_id,
		versionSlug,
	};
}

export function buildPublicDocsSyncManifest(input: {
	entries: readonly DocumentReaderPublishEntry[];
	generatedAt: string;
}): PublicDocsSyncManifest {
	return {
		entries: input.entries.filter(
			(entry) =>
				entry.deliveryMode === "public_static_asset" || entry.deliveryMode === "gated_asset",
		),
		generatedAt: input.generatedAt,
		surface: "public_docs",
	};
}

function parseRecord(value: DocumentReaderRegistryRecord): DocumentReaderRegistryRecord {
	const parsed = DocumentReaderRegistryRecordSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`document reader registry record is invalid: ${formatZodIssues(parsed.error.issues, "record").join("; ")}`,
		);
	}
	return {
		...parsed.data,
		canonical_markdown_object_key: parseOptionalText(parsed.data.canonical_markdown_object_key),
		document_units_object_key: parseOptionalText(parsed.data.document_units_object_key),
		effective_date: parseOptionalText(parsed.data.effective_date),
		entitlement_groups: parsed.data.entitlement_groups ?? [],
		is_current: Boolean(parsed.data.is_current),
		published_date: parseOptionalText(parsed.data.published_date),
		visibility_level: parseOptionalText(parsed.data.visibility_level),
		visibility_scope: parseOptionalText(parsed.data.visibility_scope),
	};
}

function parseStructuredUnits(
	value: readonly unknown[] | string | Uint8Array,
	record: DocumentReaderRegistryRecord,
): StructuredUnit[] {
	const rows =
		typeof value === "string" || value instanceof Uint8Array
			? parseJsonObjectLinesBytes(value, "document reader units")
			: [...value];
	return rows.map((row, index) => {
		const parsed = DocumentUnitSchema.safeParse(row);
		if (!parsed.success) {
			throw new Error(
				`document reader unit is invalid: ${formatZodIssues(parsed.error.issues, `units[${index}]`).join("; ")}`,
			);
		}
		if (parsed.data.doc_id !== record.document_id) {
			throw new Error(
				`structured doc_id ${JSON.stringify(parsed.data.doc_id)} does not match registry document_id ${JSON.stringify(record.document_id)}`,
			);
		}
		if (parsed.data.version_id !== record.version_id) {
			throw new Error(
				`structured version_id ${JSON.stringify(parsed.data.version_id)} does not match registry version_id ${JSON.stringify(record.version_id)}`,
			);
		}
		const text = parsed.data.clean_text ?? parsed.data.text ?? "";
		if (!text.trim()) {
			throw new Error(`document reader unit ${index} is missing text`);
		}
		return {
			anchor: parsed.data.anchor,
			metadata: parsed.data.metadata,
			rootUnitId: parsed.data.root_unit_id ?? parsed.data.chunk_id ?? `unit-${index}`,
			sourceChunkId: parsed.data.chunk_id ?? null,
			text,
			unitIndex: index,
			unitType: parsed.data.unit_type.trim().toLowerCase(),
		};
	});
}

function buildReaderSections(units: readonly StructuredUnit[]): Record<string, unknown>[] {
	const sectionsByKey = new Map<string, Record<string, unknown>>();
	const orderedKeys: string[] = [];
	for (const unit of units) {
		const sectionPath = normalizeSectionPath(unit.anchor);
		const key = JSON.stringify(sectionPath);
		let section = sectionsByKey.get(key);
		if (!section) {
			section = {
				anchor: anchorForPath(sectionPath),
				blocks: [],
				order: orderedKeys.length + 1,
				title: sectionPath.at(-1) ?? "文档正文",
			};
			sectionsByKey.set(key, section);
			orderedKeys.push(key);
		}
		(section.blocks as Record<string, unknown>[]).push({
			inlineLabels: buildInlineLabels(unit),
			kind: resolveBlockKind(unit),
			rootUnitId: unit.rootUnitId,
			text: unit.text.trim(),
		});
	}
	return orderedKeys.map((key) => sectionsByKey.get(key) as Record<string, unknown>);
}

function buildOutlineNodes(units: readonly StructuredUnit[]): Record<string, unknown>[] {
	const nodes: Record<string, unknown>[] = [];
	const seenPaths = new Set<string>();
	let order = 1;
	for (const unit of units) {
		const sectionPath = normalizeSectionPath(unit.anchor);
		for (let depth = 1; depth <= sectionPath.length; depth += 1) {
			const currentPath = sectionPath.slice(0, depth);
			const pathKey = JSON.stringify(currentPath);
			if (seenPaths.has(pathKey)) {
				continue;
			}
			seenPaths.add(pathKey);
			nodes.push({
				anchor: anchorForPath(currentPath),
				depth,
				order,
				parentAnchor: depth > 1 ? anchorForPath(currentPath.slice(0, -1)) : null,
				title: currentPath.at(-1) ?? "",
			});
			order += 1;
		}
	}
	return nodes;
}

function buildAssetManifest(input: {
	assets: Record<string, Uint8Array>;
	canonicalUrl: string;
	record: DocumentReaderRegistryRecord;
}): Record<string, unknown> {
	const files: Record<string, Record<string, unknown>> = {};
	for (const [filename, payload] of Object.entries(input.assets)) {
		files[filename] = {
			contentType: contentTypeForFilename(filename),
			sha256: sha256Hex(payload),
			sizeBytes: payload.byteLength,
		};
	}
	return {
		docId: input.record.document_id,
		files,
		readerTarget: {
			anchor: null,
			canonicalUrl: input.canonicalUrl,
			docId: input.record.document_id,
			highlightRootUnitIds: [],
			versionId: input.record.version_id,
		},
		schemaVersion: READER_SCHEMA_VERSION,
		supplementFiles: Object.keys(input.assets).filter((name) => !CORE_ASSET_FILE_SET.has(name)),
		versionId: input.record.version_id,
	};
}

function buildCourseMapAssets(input: {
	courseMapImageObjects: Record<string, Uint8Array>;
	courseMapsJson: unknown;
	record: DocumentReaderRegistryRecord;
}): Record<string, Uint8Array> {
	const parsed = CourseMapSurfaceSchema.safeParse(input.courseMapsJson);
	if (!parsed.success) {
		throw new Error(
			`course-map docs surface is invalid: ${formatZodIssues(parsed.error.issues, "course_maps").join("; ")}`,
		);
	}
	const assets: Record<string, Uint8Array> = {};
	const blocks = parsed.data.blocks.map((block) => {
		const imageName = pathPosix.basename(block.imageObjectKey);
		const imagePath = joinPath(COURSE_MAPS_DIRECTORY, imageName);
		const imageBytes = input.courseMapImageObjects[block.imageObjectKey];
		if (!imageBytes) {
			throw new Error(`missing course-map image bytes for ${block.imageObjectKey}`);
		}
		assets[imagePath] = imageBytes;
		return {
			blockId: block.blockId,
			displayStageLabels: block.displayStageLabels,
			edges: block.edges.map((edge) => ({
				edgeId: edge.edge_id,
				sourceLabel: edge.source_label,
				sourceNodeId: edge.source_node_id,
				targetLabel: edge.target_label,
				targetNodeId: edge.target_node_id,
			})),
			extractionNotes: block.extractionNotes,
			imagePath,
			mapIndex: block.mapIndex,
			nodes: block.nodes.map((node) => ({
				categoryLabel: node.category_label,
				nodeId: node.node_id,
				nodeLabel: node.node_label,
				stageId: node.stage_id,
				stageLabel: node.stage_label,
			})),
			pageNumber: block.pageNumber,
			parentHeadingHint: block.parentHeadingHint,
			regionBBoxProvider: block.regionBBoxProvider,
			rowId: block.rowId,
			status: block.status,
			title: block.title,
			titleConfidence: block.titleConfidence,
		};
	});
	assets[COURSE_MAPS_FILENAME] = jsonBytes({
		blocks,
		docId: input.record.document_id,
		schemaVersion: "curriculum_course_maps_reader_v1",
		versionId: input.record.version_id,
	});
	return assets;
}

function resolveDocumentTitle(input: {
	canonicalMarkdown: string;
	record: DocumentReaderRegistryRecord;
	units: readonly StructuredUnit[];
}): string {
	if (input.record.corpus === "regulations" && input.record.collection === "institutional_rules") {
		for (const unit of input.units) {
			const title = parseOptionalText(unit.metadata.title);
			if (title) {
				return title;
			}
		}
	}
	for (const line of input.canonicalMarkdown.split(/\r?\n/u)) {
		const normalized = line.trim();
		if (normalized.startsWith("# ")) {
			return normalized.slice(2).trim();
		}
	}
	for (const unit of input.units) {
		const title = parseOptionalText(unit.metadata.title);
		if (title) {
			return title;
		}
		if (unit.text.trim()) {
			return unit.text.trim();
		}
	}
	return resolveDocumentSlug({ record: input.record, title: input.record.document_id });
}

function resolveDocumentSlug(input: {
	record: DocumentReaderRegistryRecord;
	title: string;
}): string {
	const objectKey =
		input.record.document_units_object_key ?? input.record.canonical_markdown_object_key ?? "";
	if (objectKey) {
		const parts = objectKey.split("/");
		const directoryName = parts.at(-4) ?? "";
		if (directoryName.includes("--")) {
			const candidate = directoryName.split("--", 1)[0]?.trim();
			if (candidate) {
				return candidate;
			}
		}
	}
	return slugifyLabel(input.title) || slugifyLabel(input.record.document_id) || "document";
}

function resolveVersionSlug(record: DocumentReaderRegistryRecord): string {
	if (record.corpus === "regulations" && record.collection === "institutional_rules") {
		const effectiveSlug = resolveEffectiveDateVersionSlug(record.effective_date);
		if (effectiveSlug) {
			return effectiveSlug;
		}
	}
	const year = resolvePublishedYear(record);
	const suffix = record.is_current ? "current" : slugifyLabel(record.revision_track);
	return `${year}-${suffix}`;
}

function resolveEffectiveDateVersionSlug(value: string | null | undefined): string | null {
	const normalized = (value ?? "").trim();
	if (!normalized) {
		return null;
	}
	const match =
		/(?<year>(?:19|20)\d{2})\s*(?:年|[-/.])\s*(?<month>\d{1,2})\s*(?:月|[-/.])\s*(?<day>\d{1,2})/u.exec(
			normalized,
		);
	if (match?.groups) {
		return `effective-${match.groups.year}-${Number(match.groups.month).toString().padStart(2, "0")}-${Number(match.groups.day).toString().padStart(2, "0")}`;
	}
	const yearMatch = /(?:19|20)\d{2}/u.exec(normalized);
	return yearMatch ? `effective-${yearMatch[0]}` : null;
}

function resolvePublishedYear(record: DocumentReaderRegistryRecord): string {
	const objectKey = record.document_units_object_key ?? record.canonical_markdown_object_key ?? "";
	if (objectKey) {
		const candidate = objectKey.split("/").at(-2)?.trim() ?? "";
		if (/^(?:19|20)\d{2}|undated$/u.test(candidate)) {
			return candidate;
		}
	}
	for (const value of [record.effective_date, record.published_date, record.ingestion_timestamp]) {
		const match = /(?:19|20)\d{2}/u.exec(value ?? "");
		if (match) {
			return match[0];
		}
	}
	return "undated";
}

function resolveVisibility(record: DocumentReaderRegistryRecord): string {
	return (
		record.visibility_level?.trim() ||
		(record.entitlement_groups && record.entitlement_groups.length > 0 ? "restricted" : "public")
	);
}

function buildCanonicalUrl(input: {
	collection: string;
	corpus: string;
	documentSlug: string;
}): string {
	return `/${joinPath("docs", input.corpus, input.collection, input.documentSlug)}`;
}

function buildReaderAssetKey(input: {
	assetName: string;
	record: DocumentReaderRegistryRecord;
	title: string;
}): string {
	const coreName = CORE_ASSET_FILE_SET.has(input.assetName) ? input.assetName : "reader.json";
	const baseKey = buildDocumentArtifactKey({
		collection: input.record.collection,
		corpus: input.record.corpus,
		documentId: input.record.document_id,
		filename: `reader-assets/${coreName}`,
		revisionTrack: input.record.revision_track,
		title: input.title,
		versionId: input.record.version_id,
		year: resolvePublishedYear(input.record),
	});
	if (CORE_ASSET_FILE_SET.has(input.assetName)) {
		return baseKey;
	}
	return joinPath(pathPosix.dirname(baseKey), input.assetName);
}

function resolvePublishObjectLabels(assetName: string): [string, string] {
	const coreLabels: Record<string, [string, string]> = {
		"asset-manifest.json": ["manifest", "asset-manifest"],
		"meta.json": ["meta", "meta"],
		"outline.json": ["outline", "outline"],
		"reader.json": ["reader", "reader"],
	};
	return coreLabels[assetName] ?? [`supplement.${assetName}`, assetName];
}

function validateReaderAssetName(assetName: string): string {
	const normalized = assetName.trim().replace(/^\/+|\/+$/gu, "");
	if (!normalized) {
		throw new Error("assetName is required");
	}
	if (pathPosix.isAbsolute(normalized) || normalized.split("/").includes("..")) {
		throw new Error("assetName must stay within reader-assets");
	}
	return normalized;
}

function normalizeSectionPath(anchor: Record<string, unknown>): string[] {
	const rawPath = anchor.section_path;
	if (Array.isArray(rawPath)) {
		const path = rawPath.map((item) => String(item).trim()).filter(Boolean);
		if (path.length > 0) {
			return path;
		}
	}
	const section = parseOptionalText(anchor.section);
	return section ? [section] : ["文档正文"];
}

function anchorForPath(path: readonly string[]): string {
	if (path.length === 0) {
		return "document";
	}
	return path.map(slugifyOrHash).join("/");
}

function slugifyOrHash(value: string): string {
	const slug = slugifyLabel(value);
	if (slug) {
		return slug;
	}
	return `section-${createHash("sha1").update(value.trim()).digest("hex").slice(0, 10)}`;
}

function slugifyLabel(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.replace(/-{2,}/gu, "-");
}

function resolveBlockKind(unit: StructuredUnit): string {
	if (unit.unitType.includes("heading")) {
		return "heading";
	}
	if (unit.unitType.includes("table")) {
		return "table";
	}
	if (unit.unitType.includes("list")) {
		return "list";
	}
	return "paragraph";
}

function buildInlineLabels(unit: StructuredUnit): string[] {
	const labels: string[] = [];
	const headingLevel = unit.metadata.heading_level;
	if (typeof headingLevel === "number" && headingLevel > 0) {
		labels.push(`h${headingLevel}`);
	}
	const pageStart = unit.anchor.page_start;
	const pageEnd = unit.anchor.page_end;
	if (typeof pageStart === "number" && typeof pageEnd === "number") {
		labels.push(pageStart === pageEnd ? `p${pageStart}` : `p${pageStart}-${pageEnd}`);
	}
	return labels;
}

function contentTypeForFilename(filename: string): string {
	return filename.endsWith(".png") ? "image/png" : "application/json";
}

function jsonBytes(value: unknown): Uint8Array {
	return encodeCanonicalJson(value);
}

function decodeUtf8(value: string | Uint8Array): string {
	return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function joinPath(...segments: readonly string[]): string {
	return segments
		.map((segment) => segment.trim().replace(/^\/+|\/+$/gu, ""))
		.filter(Boolean)
		.join("/");
}
