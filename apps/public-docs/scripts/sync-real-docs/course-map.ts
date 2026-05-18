import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
	node_id?: string;
	node_label: string;
	stage_id?: string;
	stage_label?: string;
	category_label?: string;
}

interface CourseMapEdge {
	edge_id?: string;
	source_node_id?: string;
	source_label: string;
	target_node_id?: string;
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
	imagePath?: string;
	imageObjectKey?: string;
	nodes: CourseMapNode[];
	edges: CourseMapEdge[];
}

interface CourseMapSurface {
	docId?: string;
	schemaVersion?: string;
	versionId?: string;
	documentId?: string;
	documentTitle?: string;
	generatedAt?: string;
	rawAssetId?: string;
	rawVersionId?: string;
	blocks: CourseMapBlock[];
}

interface NormalizedCourseMapNode {
	node_id: string;
	node_label: string;
	stage_id: string;
	stage_label: string;
	category_label: string;
	route_group: string;
	incoming_count: number;
	outgoing_count: number;
}

interface NormalizedCourseMapEdge {
	edge_id: string;
	source_node_id: string;
	source_label: string;
	target_node_id: string;
	target_label: string;
}

interface NormalizedCourseMapBlockPayload {
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
	imageSrc: string;
	nodes: NormalizedCourseMapNode[];
	edges: NormalizedCourseMapEdge[];
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
		const dataPayload = buildCourseMapDataPayload({
			documentTitle: doc.title,
			publicSlug: doc.slug,
			surface,
		});
		const imagePayloads: Array<{ fileName: string; imageBytes: Uint8Array }> = [];
		for (const block of surface.blocks) {
			const imageReference = resolveCourseMapImageReference(block);
			const imageObjectKey = buildCourseMapImageObjectKey({
				imageReference,
				surfaceKey,
			});
			const imageBytes = await input.client.readOptionalBytesObject({ key: imageObjectKey });
			if (!imageBytes) {
				throw new Error(
					`missing published course-map image object for ${doc.slug}: ${imageObjectKey}`,
				);
			}
			imagePayloads.push({
				fileName: basename(imageObjectKey),
				imageBytes,
			});
		}
		rmSync(imageDir, { force: true, recursive: true });
		mkdirSync(imageDir, { recursive: true });
		for (const imagePayload of imagePayloads) {
			writeFileSync(resolve(imageDir, imagePayload.fileName), imagePayload.imageBytes);
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
	documentTitle?: string;
	surface: CourseMapSurface;
	publicSlug: string;
}): Record<string, unknown> {
	const documentTitle = input.documentTitle ?? input.surface.documentTitle ?? "";
	return {
		documentId: input.surface.docId || input.surface.documentId || "",
		documentTitle,
		generatedAt: input.surface.generatedAt ?? "",
		rawAssetId: input.surface.rawAssetId ?? "",
		rawVersionId: input.surface.versionId || input.surface.rawVersionId || "",
		blocks: input.surface.blocks.map((block) =>
			buildCourseMapBlockPayload({
				block,
				documentTitle,
				publicSlug: input.publicSlug,
			}),
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

export function normalizeCourseMapNodeLabel(nodeLabel: string): string {
	const normalized = nodeLabel.trim();
	const replacements = new Map<string, string>([
		["中近现代史纲要", "中国近现代史纲要"],
		["高散结构", "离散结构"],
	]);
	return replacements.get(normalized) ?? normalized;
}

export function normalizeCourseMapStageLabel(stageLabel: string): string {
	const normalized = stageLabel.trim();
	if (!normalized) {
		return "";
	}
	if (/^[上下]学期$/.test(normalized)) {
		return "未按学期拆分";
	}
	return normalized;
}

export function resolveCourseMapPublicTitle(input: {
	documentTitle: string;
	mapIndex: number;
	title: string;
	titleConfidence?: string;
}): { title: string; titleConfidence: string } {
	const title = input.title.trim();
	if (!title || isGenericCourseMapTitle(title)) {
		const suffix = input.mapIndex > 1 ? `（第 ${input.mapIndex} 张）` : "";
		return {
			title: `${input.documentTitle.trim()}课程地图${suffix}`,
			titleConfidence: "absent",
		};
	}
	return {
		title,
		titleConfidence: input.titleConfidence ?? "visible",
	};
}

function isGenericCourseMapTitle(title: string): boolean {
	const normalized = title.replace(/\s+/g, "");
	return /^(?:[一二三四五六七八九十]+、)?课程地图$/.test(normalized);
}

function buildCourseMapBlockPayload(input: {
	block: CourseMapBlock;
	documentTitle: string;
	publicSlug: string;
}): NormalizedCourseMapBlockPayload {
	const imageReference = resolveCourseMapImageReference(input.block);
	const normalizedNodes = buildNormalizedCourseMapNodes(input.block.nodes);
	const normalizedEdges = buildNormalizedCourseMapEdges({
		edges: input.block.edges,
		nodes: normalizedNodes,
	});
	const incomingCounts = new Map<string, number>();
	const outgoingCounts = new Map<string, number>();
	for (const edge of normalizedEdges.edges) {
		outgoingCounts.set(edge.source_node_id, (outgoingCounts.get(edge.source_node_id) ?? 0) + 1);
		incomingCounts.set(edge.target_node_id, (incomingCounts.get(edge.target_node_id) ?? 0) + 1);
	}
	const displayStageLabels = resolvePublishableStageLabels({
		displayStageLabels: input.block.displayStageLabels,
		nodes: normalizedNodes,
	});
	const structurePublishable = normalizedNodes.length > 0 && displayStageLabels.length > 0;
	const extractionNotes = [
		...input.block.extractionNotes,
		...normalizedEdges.notes,
		...(structurePublishable
			? []
			: normalizedNodes.length > 0
				? ["未识别到可用于阅读分组的阶段信息，当前仅发布原始区域图。"]
				: []),
	];
	const publicTitle = resolveCourseMapPublicTitle({
		documentTitle: input.documentTitle,
		mapIndex: input.block.mapIndex,
		title: input.block.title,
		titleConfidence: input.block.titleConfidence,
	});
	return {
		blockId: input.block.blockId,
		title: publicTitle.title,
		status: structurePublishable ? input.block.status : "failed",
		titleConfidence: publicTitle.titleConfidence,
		pageNumber: input.block.pageNumber,
		rowId: input.block.rowId,
		mapIndex: input.block.mapIndex,
		parentHeadingHint: input.block.parentHeadingHint,
		displayStageLabels,
		extractionNotes: Array.from(new Set(extractionNotes.filter(Boolean))),
		imageSrc: `/course-maps/${input.publicSlug}/${basename(imageReference)}`,
		nodes: normalizedNodes.map((node) => ({
			...node,
			incoming_count: incomingCounts.get(node.node_id) ?? 0,
			outgoing_count: outgoingCounts.get(node.node_id) ?? 0,
		})),
		edges: normalizedEdges.edges,
	};
}

function buildNormalizedCourseMapNodes(nodes: CourseMapNode[]): NormalizedCourseMapNode[] {
	return nodes.map((node, index) => {
		const nodeLabel = normalizeCourseMapNodeLabel(node.node_label);
		const stageLabel = normalizeCourseMapStageLabel(String(node.stage_label ?? ""));
		const stageId = normalizeCourseMapIdentifier(
			String(node.stage_id ?? "").trim() ||
				buildHashedCourseMapId("stage", stageLabel || "unknown"),
		);
		return {
			node_id: normalizeCourseMapIdentifier(
				String(node.node_id ?? "").trim() ||
					buildHashedCourseMapId("node", `${stageId}|${stageLabel}|${nodeLabel}|${index}`),
			),
			node_label: nodeLabel,
			stage_id: stageId,
			stage_label: stageLabel,
			category_label: String(node.category_label ?? "").trim(),
			route_group: inferCourseMapRouteGroup(nodeLabel),
			incoming_count: 0,
			outgoing_count: 0,
		};
	});
}

function buildNormalizedCourseMapEdges(input: {
	edges: CourseMapEdge[];
	nodes: NormalizedCourseMapNode[];
}): { edges: NormalizedCourseMapEdge[]; notes: string[] } {
	const notes: string[] = [];
	const nodeById = new Map(input.nodes.map((node) => [node.node_id, node]));
	const nodeIdsByLabel = new Map<string, string[]>();
	for (const node of input.nodes) {
		const existing = nodeIdsByLabel.get(node.node_label) ?? [];
		existing.push(node.node_id);
		nodeIdsByLabel.set(node.node_label, existing);
	}
	const edges: NormalizedCourseMapEdge[] = [];
	for (const [index, edge] of input.edges.entries()) {
		const sourceLabel = normalizeCourseMapNodeLabel(edge.source_label);
		const targetLabel = normalizeCourseMapNodeLabel(edge.target_label);
		const sourceNodeId =
			normalizeCourseMapIdentifier(String(edge.source_node_id ?? "").trim()) ||
			resolveUniqueNodeIdForLabel({
				label: sourceLabel,
				nodeIdsByLabel,
				notes,
				endpointName: "source",
			});
		const targetNodeId =
			normalizeCourseMapIdentifier(String(edge.target_node_id ?? "").trim()) ||
			resolveUniqueNodeIdForLabel({
				label: targetLabel,
				nodeIdsByLabel,
				notes,
				endpointName: "target",
			});
		const sourceNode = nodeById.get(sourceNodeId);
		const targetNode = nodeById.get(targetNodeId);
		if (!(sourceNode && targetNode)) {
			notes.push("存在无法定位到唯一课程节点的关系，已从结构化关系中移除。");
			continue;
		}
		edges.push({
			edge_id:
				normalizeCourseMapIdentifier(String(edge.edge_id ?? "").trim()) ||
				buildHashedCourseMapId("edge", `${sourceNodeId}->${targetNodeId}#${index}`),
			source_node_id: sourceNodeId,
			source_label: sourceLabel || sourceNode.node_label,
			target_node_id: targetNodeId,
			target_label: targetLabel || targetNode.node_label,
		});
	}
	return { edges, notes: Array.from(new Set(notes)) };
}

function resolveUniqueNodeIdForLabel(input: {
	label: string;
	nodeIdsByLabel: Map<string, string[]>;
	notes: string[];
	endpointName: "source" | "target";
}): string {
	if (!input.label) {
		input.notes.push("存在端点为空的课程关系，已从结构化关系中移除。");
		return "";
	}
	const nodeIds = input.nodeIdsByLabel.get(input.label) ?? [];
	if (nodeIds.length === 1) {
		return nodeIds[0] ?? "";
	}
	if (nodeIds.length === 0) {
		input.notes.push(`存在引用未发布课程节点的关系，已从结构化关系中移除：${input.label}。`);
		return "";
	}
	input.notes.push(
		`存在同名课程节点导致无法唯一定位的关系端点，已从结构化关系中移除：${input.label}（${input.endpointName}）。`,
	);
	return "";
}

function resolvePublishableStageLabels(input: {
	displayStageLabels: string[];
	nodes: NormalizedCourseMapNode[];
}): string[] {
	const declared = input.displayStageLabels
		.map((label) => normalizeCourseMapStageLabel(label))
		.filter(Boolean);
	if (declared.length > 0) {
		return Array.from(new Set(declared));
	}
	return Array.from(new Set(input.nodes.map((node) => node.stage_label).filter(Boolean)));
}

function normalizeCourseMapIdentifier(value: string): string {
	const normalized = value
		.trim()
		.replace(/[^0-9A-Za-z_.:-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return normalized || (value.trim() ? buildHashedCourseMapId("id", value.trim()) : "");
}

function buildHashedCourseMapId(prefix: string, value: string): string {
	return `${prefix}-${createHash("sha1").update(value).digest("hex").slice(0, 12)}`;
}

function buildCurriculumCourseMapDocsSurfaceObjectKey(documentUnitsKey: string): string {
	if (!documentUnitsKey.endsWith("/document-units.jsonl")) {
		throw new Error("document_units_key must point to document-units.jsonl");
	}
	return `${documentUnitsKey.slice(0, -"document-units.jsonl".length)}reader-assets/course-maps.json`;
}

function resolveCourseMapImageReference(block: CourseMapBlock): string {
	return String(block.imagePath || block.imageObjectKey || "").trim();
}

function buildCourseMapImageObjectKey(input: {
	imageReference: string;
	surfaceKey: string;
}): string {
	const normalizedReference = input.imageReference.trim();
	if (!normalizedReference) {
		throw new Error(`course-map block is missing imagePath/imageObjectKey: ${input.surfaceKey}`);
	}
	if (/^(?:curriculum|regulations)\//.test(normalizedReference)) {
		return normalizedReference;
	}
	const normalizedPath = normalizedReference.replace(/^\/+/, "");
	if (normalizedPath.includes("..")) {
		throw new Error(`course-map imagePath escapes reader-assets directory: ${normalizedPath}`);
	}
	const readerAssetsPrefix = input.surfaceKey.slice(0, -"course-maps.json".length);
	return `${readerAssetsPrefix}${normalizedPath}`;
}

function loadCurriculumCourseMapDocsSurface(payload: Uint8Array): CourseMapSurface {
	const raw = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
	const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
	return {
		docId: String(raw.docId ?? raw.documentId ?? "").trim(),
		schemaVersion: String(raw.schemaVersion ?? "").trim(),
		versionId: String(raw.versionId ?? raw.rawVersionId ?? "").trim(),
		documentId: String(raw.documentId ?? raw.docId ?? "").trim(),
		documentTitle: String(raw.documentTitle ?? "").trim(),
		generatedAt: String(raw.generatedAt ?? "").trim(),
		rawAssetId: String(raw.rawAssetId ?? "").trim(),
		rawVersionId: String(raw.rawVersionId ?? raw.versionId ?? "").trim(),
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
		imagePath: String(record.imagePath ?? record.imageObjectKey ?? "").trim(),
		imageObjectKey: String(record.imageObjectKey ?? "").trim() || undefined,
		nodes: Array.isArray(record.nodes) ? record.nodes.map(coerceCourseMapNode) : [],
		edges: Array.isArray(record.edges) ? record.edges.map(coerceCourseMapEdge) : [],
	};
}

function coerceCourseMapNode(value: unknown): CourseMapNode {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	return {
		node_id: String(record.node_id ?? record.nodeId ?? "").trim(),
		node_label: String(record.node_label ?? record.nodeLabel ?? "").trim(),
		stage_id: String(record.stage_id ?? record.stageId ?? "").trim(),
		stage_label: String(record.stage_label ?? record.stageLabel ?? "").trim(),
		category_label: String(record.category_label ?? record.categoryLabel ?? "").trim(),
	};
}

function coerceCourseMapEdge(value: unknown): CourseMapEdge {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	return {
		edge_id: String(record.edge_id ?? record.edgeId ?? "").trim(),
		source_node_id: String(record.source_node_id ?? record.sourceNodeId ?? "").trim(),
		source_label: String(record.source_label ?? record.sourceLabel ?? "").trim(),
		target_node_id: String(record.target_node_id ?? record.targetNodeId ?? "").trim(),
		target_label: String(record.target_label ?? record.targetLabel ?? "").trim(),
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
