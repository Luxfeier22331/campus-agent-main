import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
	buildAppSrcImportPath,
	COURSE_MAP_EXTENSION_KEYWORDS,
	COURSE_MAP_FOUNDATION_KEYWORDS,
	COURSE_MAP_PRACTICE_KEYWORDS,
	type CourseMapDocEmbed,
	type CurriculumDoc,
	formatJsObjectLiteral,
	REPO_ROOT,
	removeStaleGeneratedFiles,
	sha1Hex,
	writeText,
} from "./shared";
import type { ObjectStoreClient } from "./storage";

interface CourseMapNode {
	node_label: string;
	stage_label?: string;
	category_label?: string;
}

interface CourseMapEdge {
	source_label: string;
	target_label: string;
}

interface CourseMapBlock {
	blockId: string;
	title: string;
	status: string;
	titleConfidence: string;
	pageNumber: number;
	rowId: string;
	mapIndex: number;
	parentHeadingHint: string;
	displayStageLabels: string[];
	extractionNotes: string[];
	imageObjectKey: string;
	nodes: CourseMapNode[];
	edges: CourseMapEdge[];
}

interface CourseMapSurface {
	generatedAt: string;
	documentTitle: string;
	documentId: string;
	rawAssetId: string;
	rawVersionId: string;
	blocks: CourseMapBlock[];
}

export async function syncCurriculumCourseMapArtifacts(input: {
	client: ObjectStoreClient;
	curriculumDocs: CurriculumDoc[];
	docsRoot: string;
}): Promise<Map<string, CourseMapDocEmbed>> {
	const generatedDir = resolve(input.docsRoot, "../src/generated/course-maps");
	const publicRoot = resolve(input.docsRoot, "public/course-maps");
	mkdirSync(generatedDir, { recursive: true });
	mkdirSync(publicRoot, { recursive: true });

	const embeds = new Map<string, CourseMapDocEmbed>();
	const expectedDataFiles = new Set<string>();
	const expectedPublicDirs = new Set<string>();
	for (const doc of input.curriculumDocs) {
		const surfaceKey = buildCurriculumCourseMapDocsSurfaceObjectKey(doc.key);
		const surfaceBytes = await input.client.readOptionalBytesObject({ key: surfaceKey });
		if (!surfaceBytes) {
			continue;
		}
		const surface = loadCurriculumCourseMapDocsSurface(surfaceBytes);
		if (surface.blocks.length === 0) {
			continue;
		}
		const dataModuleName = `${doc.slug}.data.ts`;
		const imageDir = resolve(publicRoot, doc.slug);
		mkdirSync(imageDir, { recursive: true });
		const dataPayload = buildCourseMapDataPayload({ surface, publicSlug: doc.slug });
		for (const block of surface.blocks) {
			const imageBytes = await input.client.readOptionalBytesObject({ key: block.imageObjectKey });
			if (!imageBytes) {
				throw new Error(
					`missing published course-map image object for ${doc.slug}: ${block.imageObjectKey}`,
				);
			}
			writeFileSync(resolve(imageDir, basename(block.imageObjectKey)), imageBytes);
		}
		writeText(
			resolve(generatedDir, dataModuleName),
			buildCourseMapDataModule(dataPayload, {
				biomeFilePath: `apps/public-docs/src/generated/course-maps/${dataModuleName}`,
			}),
		);
		expectedDataFiles.add(dataModuleName);
		expectedPublicDirs.add(doc.slug);
		embeds.set(
			doc.slug,
			buildCourseMapDocEmbedForRoute({
				dataImportName: buildCourseMapDataImportName(doc.slug),
				routeDepthFromDocsRoot: 0,
				slug: doc.slug,
			}),
		);
	}
	removeStaleGeneratedFiles(generatedDir, expectedDataFiles);
	for (const name of readdirSync(publicRoot)) {
		if (!expectedPublicDirs.has(name)) {
			rmSync(resolve(publicRoot, name), { force: true, recursive: true });
		}
	}
	return embeds;
}

export function buildCourseMapDocEmbedForRoute(input: {
	dataImportName: string;
	routeDepthFromDocsRoot: number;
	slug: string;
}): CourseMapDocEmbed {
	return {
		componentImportPath: buildAppSrcImportPath({
			routeDepthFromDocsRoot: input.routeDepthFromDocsRoot,
			srcPath: "components/CourseMapSection",
		}),
		dataImportName: input.dataImportName,
		dataImportPath: buildAppSrcImportPath({
			routeDepthFromDocsRoot: input.routeDepthFromDocsRoot,
			srcPath: `generated/course-maps/${input.slug}.data`,
		}),
	};
}

export function buildCourseMapSectionBlock(courseMapEmbed: CourseMapDocEmbed): string {
	return `<CourseMapSection data={${courseMapEmbed.dataImportName}} />`;
}

export function buildCourseMapDataImportName(slug: string): string {
	const parts = slug.split(/[^a-zA-Z0-9]+/).filter(Boolean);
	if (parts.length === 0) {
		return `courseMapData${sha1Hex(slug).slice(0, 8)}`;
	}
	const [head, ...tail] = parts;
	return `${head}${tail.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join("")}Data`;
}

export function buildCourseMapDataModule(
	payload: unknown,
	input: { biomeFilePath: string },
): string {
	const content = [
		`const data = ${formatJsObjectLiteral(payload)} as const;`,
		"",
		"export default data;",
		"",
	].join("\n");
	return formatWithBiome(content, input.biomeFilePath);
}

export function buildCourseMapDataPayload(input: {
	surface: CourseMapSurface;
	publicSlug: string;
}): Record<string, unknown> {
	return {
		generatedAt: input.surface.generatedAt,
		documentTitle: input.surface.documentTitle,
		documentId: input.surface.documentId,
		rawAssetId: input.surface.rawAssetId,
		rawVersionId: input.surface.rawVersionId,
		blocks: input.surface.blocks.map((block) =>
			buildCourseMapBlockPayload({ block, publicSlug: input.publicSlug }),
		),
	};
}

export function inferCourseMapRouteGroup(nodeLabel: string): string {
	const normalized = nodeLabel.trim();
	if (COURSE_MAP_PRACTICE_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
		return "practice";
	}
	if (COURSE_MAP_EXTENSION_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
		return "extension";
	}
	if (COURSE_MAP_FOUNDATION_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
		return "foundation";
	}
	return "core";
}

function buildCourseMapBlockPayload(input: {
	block: CourseMapBlock;
	publicSlug: string;
}): Record<string, unknown> {
	const incomingCounts = new Map<string, number>();
	const outgoingCounts = new Map<string, number>();
	for (const edge of input.block.edges) {
		const sourceLabel = String(edge.source_label ?? "").trim();
		const targetLabel = String(edge.target_label ?? "").trim();
		if (sourceLabel) {
			outgoingCounts.set(sourceLabel, (outgoingCounts.get(sourceLabel) ?? 0) + 1);
		}
		if (targetLabel) {
			incomingCounts.set(targetLabel, (incomingCounts.get(targetLabel) ?? 0) + 1);
		}
	}
	return {
		blockId: input.block.blockId,
		title: input.block.title,
		status: input.block.status,
		titleConfidence: input.block.titleConfidence,
		pageNumber: input.block.pageNumber,
		rowId: input.block.rowId,
		mapIndex: input.block.mapIndex,
		parentHeadingHint: input.block.parentHeadingHint,
		displayStageLabels: input.block.displayStageLabels,
		extractionNotes: input.block.extractionNotes,
		imageSrc: `/course-maps/${input.publicSlug}/${basename(input.block.imageObjectKey)}`,
		nodes: input.block.nodes.map((node) => ({
			...node,
			route_group: inferCourseMapRouteGroup(node.node_label),
			incoming_count: incomingCounts.get(node.node_label) ?? 0,
			outgoing_count: outgoingCounts.get(node.node_label) ?? 0,
		})),
		edges: input.block.edges,
	};
}

function buildCurriculumCourseMapDocsSurfaceObjectKey(documentUnitsKey: string): string {
	if (!documentUnitsKey.endsWith("/document-units.jsonl")) {
		throw new Error("document_units_key must point to document-units.jsonl");
	}
	return `${documentUnitsKey.slice(0, -"document-units.jsonl".length)}reader-assets/course-maps.json`;
}

function loadCurriculumCourseMapDocsSurface(payload: Uint8Array): CourseMapSurface {
	const raw = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
	const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
	return {
		generatedAt: String(raw.generatedAt ?? "").trim(),
		documentTitle: String(raw.documentTitle ?? "").trim(),
		documentId: String(raw.documentId ?? "").trim(),
		rawAssetId: String(raw.rawAssetId ?? "").trim(),
		rawVersionId: String(raw.rawVersionId ?? "").trim(),
		blocks: blocks.map(coerceCourseMapBlock),
	};
}

function coerceCourseMapBlock(value: unknown): CourseMapBlock {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	return {
		blockId: String(record.blockId ?? "").trim(),
		title: String(record.title ?? "").trim(),
		status: String(record.status ?? "").trim(),
		titleConfidence: String(record.titleConfidence ?? "").trim(),
		pageNumber: Number(record.pageNumber ?? 0),
		rowId: String(record.rowId ?? "").trim(),
		mapIndex: Number(record.mapIndex ?? 0),
		parentHeadingHint: String(record.parentHeadingHint ?? "").trim(),
		displayStageLabels: arrayOfStrings(record.displayStageLabels),
		extractionNotes: arrayOfStrings(record.extractionNotes),
		imageObjectKey: String(record.imageObjectKey ?? "").trim(),
		nodes: Array.isArray(record.nodes) ? record.nodes.map(coerceCourseMapNode) : [],
		edges: Array.isArray(record.edges) ? record.edges.map(coerceCourseMapEdge) : [],
	};
}

function coerceCourseMapNode(value: unknown): CourseMapNode {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	return {
		node_label: String(record.node_label ?? "").trim(),
		stage_label: String(record.stage_label ?? "").trim(),
		category_label: String(record.category_label ?? "").trim(),
	};
}

function coerceCourseMapEdge(value: unknown): CourseMapEdge {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	return {
		source_label: String(record.source_label ?? "").trim(),
		target_label: String(record.target_label ?? "").trim(),
	};
}

function arrayOfStrings(value: unknown): string[] {
	return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function formatWithBiome(content: string, biomeFilePath: string): string {
	const completed = spawnSync(
		"pnpm",
		["exec", "biome", "format", "--stdin-file-path", biomeFilePath],
		{
			cwd: REPO_ROOT,
			encoding: "utf-8",
			input: content,
		},
	);
	if (completed.status !== 0) {
		throw new Error(
			`failed to format ${biomeFilePath} with Biome: ${completed.stderr.trim() || "unknown biome error"}`,
		);
	}
	return completed.stdout;
}
