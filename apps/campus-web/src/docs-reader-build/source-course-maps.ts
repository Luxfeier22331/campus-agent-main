import { createHash } from "node:crypto";
import { readPngDimensions } from "./png-dimensions.ts";
import type {
	DocsCourseMaps,
	DocsReader,
	DocsReaderElement,
	DocsReaderHeadingElement,
} from "./source-types.ts";

const MAX_HORIZONTAL_GAP = 24;
const MIN_VERTICAL_OVERLAP = 0.8;

interface SourceCourseMapBlock {
	bbox: readonly [number, number, number, number];
	blockId: string;
	imagePath: string;
	pageNumber: number;
	parentHeadingHint: string;
	sourceIndex: number;
	title: string;
}

interface LogicalCourseMap {
	parts: SourceCourseMapBlock[];
	parentHeadingHint: string;
	sourceIndex: number;
	title: string;
}

interface ReaderTarget {
	elementIndex: number;
	heading?: DocsReaderHeadingElement;
	rootUnitId: string;
	title: string;
}

export function materializeDocsCourseMaps(input: {
	assets: ReadonlyMap<string, Uint8Array>;
	documentTitle: string;
	reader: DocsReader;
	sourceBytes: Uint8Array;
}): DocsCourseMaps {
	const source = parseSourceCourseMaps(input.sourceBytes, input.reader);
	const logicalMaps = mergeAdjacentCourseMapParts(source.blocks);
	const targets = assignCourseMapTargets(logicalMaps, input.reader);
	const maps = logicalMaps.map((courseMap) => {
		const target = targets.get(courseMap);
		if (!target) {
			throw new Error(`course map target is missing: ${courseMap.parts[0]?.blockId ?? "unknown"}`);
		}
		return {
			mapId: logicalCourseMapId(courseMap.parts),
			parts: courseMap.parts.map((part) => {
				const imageBytes = input.assets.get(part.imagePath);
				if (!imageBytes) {
					throw new Error(`course map image is missing from source assets: ${part.imagePath}`);
				}
				const dimensions = readPngDimensions(imageBytes);
				if (!(dimensions.width && dimensions.height)) {
					throw new Error(`course map image dimensions are unavailable: ${part.imagePath}`);
				}
				return {
					height: dimensions.height,
					imagePath: part.imagePath,
					partId: part.blockId,
					width: dimensions.width,
				};
			}),
			targetRootUnitId: target.rootUnitId,
			title: displayCourseMapTitle({
				documentTitle: input.documentTitle,
				parentTitle: courseMap.parentHeadingHint,
				sourceTitle: courseMap.title,
				targetTitle: target.title,
			}),
		};
	});
	const courseMaps = {
		docId: input.reader.docId,
		maps,
		schemaVersion: "campus_docs_course_maps.v1",
		versionId: input.reader.versionId,
	} satisfies DocsCourseMaps;
	verifyDocsCourseMaps({ assets: input.assets, courseMaps, reader: input.reader });
	return courseMaps;
}

export function verifyDocsCourseMaps(input: {
	assets: ReadonlyMap<string, Uint8Array>;
	courseMaps: DocsCourseMaps;
	reader: DocsReader;
}): void {
	if (
		input.courseMaps.docId !== input.reader.docId ||
		input.courseMaps.versionId !== input.reader.versionId
	) {
		throw new Error("course map identity does not match reader");
	}
	if (input.courseMaps.maps.length === 0) {
		throw new Error("course map supplement must contain at least one map");
	}
	const readerRoots = new Set(input.reader.elements.map((element) => element.rootUnitId));
	const mapIds = new Set<string>();
	const partIds = new Set<string>();
	const referencedAssets = new Set<string>();
	for (const courseMap of input.courseMaps.maps) {
		if (mapIds.has(courseMap.mapId)) {
			throw new Error(`duplicate course map id: ${courseMap.mapId}`);
		}
		mapIds.add(courseMap.mapId);
		if (!readerRoots.has(courseMap.targetRootUnitId)) {
			throw new Error(`course map target is missing from reader: ${courseMap.targetRootUnitId}`);
		}
		for (const part of courseMap.parts) {
			if (partIds.has(part.partId)) {
				throw new Error(`duplicate course map part id: ${part.partId}`);
			}
			partIds.add(part.partId);
			const imageBytes = input.assets.get(part.imagePath);
			if (!imageBytes) {
				throw new Error(`course map image is missing from published assets: ${part.imagePath}`);
			}
			const dimensions = readPngDimensions(imageBytes);
			if (dimensions.width !== part.width || dimensions.height !== part.height) {
				throw new Error(`course map image dimensions do not match: ${part.imagePath}`);
			}
			referencedAssets.add(part.imagePath);
		}
	}
	const publishedAssets = [...input.assets.keys()].sort();
	const usedAssets = [...referencedAssets].sort();
	if (
		publishedAssets.length !== usedAssets.length ||
		publishedAssets.some((path, index) => path !== usedAssets[index])
	) {
		throw new Error("course map published assets do not match referenced images");
	}
}

function parseSourceCourseMaps(
	bytes: Uint8Array,
	reader: DocsReader,
): { blocks: SourceCourseMapBlock[] } {
	const payload = requiredRecord(
		JSON.parse(new TextDecoder().decode(bytes)),
		"course map supplement",
	);
	if (
		payload.schemaVersion !== "curriculum_course_maps_reader_v1" ||
		!Array.isArray(payload.blocks)
	) {
		throw new Error("unsupported course map supplement");
	}
	const docId = optionalString(payload.docId);
	const versionId = optionalString(payload.versionId);
	if (docId && docId !== reader.docId) {
		throw new Error(`course map docId does not match reader: ${docId}`);
	}
	if (versionId && versionId !== reader.versionId) {
		throw new Error(`course map versionId does not match reader: ${versionId}`);
	}
	return {
		blocks: payload.blocks.map((value, sourceIndex) => {
			const block = requiredRecord(value, `course map block ${sourceIndex}`);
			return {
				bbox: requiredBoundingBox(
					block.regionBBoxProvider,
					`course map block ${sourceIndex} regionBBoxProvider`,
				),
				blockId: requiredString(block.blockId, `course map block ${sourceIndex} blockId`),
				imagePath: requiredRelativeAssetPath(
					block.imagePath,
					`course map block ${sourceIndex} imagePath`,
				),
				pageNumber: requiredPositiveInteger(
					block.pageNumber,
					`course map block ${sourceIndex} pageNumber`,
				),
				parentHeadingHint: requiredString(
					block.parentHeadingHint,
					`course map block ${sourceIndex} parentHeadingHint`,
				),
				sourceIndex,
				title: requiredString(block.title, `course map block ${sourceIndex} title`),
			};
		}),
	};
}

function mergeAdjacentCourseMapParts(blocks: SourceCourseMapBlock[]): LogicalCourseMap[] {
	const parents = blocks.map((_, index) => index);
	const find = (index: number): number => {
		let root = index;
		while (parents[root] !== root) {
			root = parents[root] ?? root;
		}
		let current = index;
		while (parents[current] !== current) {
			const next = parents[current] ?? current;
			parents[current] = root;
			current = next;
		}
		return root;
	};
	const union = (left: number, right: number): void => {
		const leftRoot = find(left);
		const rightRoot = find(right);
		if (leftRoot !== rightRoot) {
			parents[rightRoot] = leftRoot;
		}
	};

	for (let left = 0; left < blocks.length; left += 1) {
		for (let right = left + 1; right < blocks.length; right += 1) {
			if (areAdjacentCourseMapParts(blocks[left], blocks[right])) {
				union(left, right);
			}
		}
	}

	const groups = new Map<number, SourceCourseMapBlock[]>();
	for (const [index, block] of blocks.entries()) {
		const root = find(index);
		groups.set(root, [...(groups.get(root) ?? []), block]);
	}
	return [...groups.values()]
		.map((parts) => {
			const orderedParts = [...parts].sort(
				(left, right) => left.bbox[0] - right.bbox[0] || left.sourceIndex - right.sourceIndex,
			);
			const first = orderedParts[0];
			if (!first) {
				throw new Error("course map group must not be empty");
			}
			return {
				parentHeadingHint: first.parentHeadingHint,
				parts: orderedParts,
				sourceIndex: Math.min(...orderedParts.map((part) => part.sourceIndex)),
				title: first.title,
			};
		})
		.sort((left, right) => left.sourceIndex - right.sourceIndex);
}

function areAdjacentCourseMapParts(
	left: SourceCourseMapBlock | undefined,
	right: SourceCourseMapBlock | undefined,
): boolean {
	if (!(left && right)) {
		return false;
	}
	if (
		left.pageNumber !== right.pageNumber ||
		normalizeComparableText(left.title) !== normalizeComparableText(right.title) ||
		normalizeComparableText(left.parentHeadingHint) !==
			normalizeComparableText(right.parentHeadingHint)
	) {
		return false;
	}
	const [first, second] = left.bbox[0] <= right.bbox[0] ? [left, right] : [right, left];
	const horizontalGap = second.bbox[0] - first.bbox[2];
	if (horizontalGap < 0 || horizontalGap > MAX_HORIZONTAL_GAP) {
		return false;
	}
	const overlap = Math.max(
		0,
		Math.min(first.bbox[3], second.bbox[3]) - Math.max(first.bbox[1], second.bbox[1]),
	);
	const shortestHeight = Math.min(first.bbox[3] - first.bbox[1], second.bbox[3] - second.bbox[1]);
	return overlap / shortestHeight >= MIN_VERTICAL_OVERLAP;
}

function assignCourseMapTargets(
	maps: LogicalCourseMap[],
	reader: DocsReader,
): Map<LogicalCourseMap, ReaderTarget> {
	const result = new Map<LogicalCourseMap, ReaderTarget>();
	const readerTargets = collectReaderTargets(reader);
	const mapsByParent = new Map<string, LogicalCourseMap[]>();
	for (const courseMap of maps) {
		const key = normalizeComparableText(courseMap.parentHeadingHint);
		mapsByParent.set(key, [...(mapsByParent.get(key) ?? []), courseMap]);
	}

	for (const [parentKey, siblingMaps] of mapsByParent) {
		const parentCandidates = readerTargets.filter(
			(target) => normalizeComparableText(target.title) === parentKey,
		);
		if (parentCandidates.length !== 1) {
			throw new Error(
				`course map parent must resolve to one reader unit: ${siblingMaps[0]?.parentHeadingHint ?? parentKey}`,
			);
		}
		const parent = parentCandidates[0];
		if (!parent) {
			throw new Error("course map parent must exist");
		}
		const children = parent.heading ? collectHeadingChildren(reader, parent) : [];
		const availableChildren = new Set(children);
		for (const courseMap of siblingMaps) {
			const mapTitle = normalizeComparableText(courseMap.title);
			const matches = [...availableChildren]
				.map((child) => ({ child, score: headingSubject(child.title).length }))
				.filter(({ child, score }) => score >= 2 && mapTitle.includes(headingSubject(child.title)))
				.sort((left, right) => right.score - left.score);
			if (matches[0] && (!matches[1] || matches[0].score > matches[1].score)) {
				result.set(courseMap, matches[0].child);
				availableChildren.delete(matches[0].child);
			}
		}
		const remainingMaps = siblingMaps.filter((courseMap) => !result.has(courseMap));
		const remainingChildren = children.filter((child) => availableChildren.has(child));
		if (remainingMaps.length > 0 && remainingMaps.length === remainingChildren.length) {
			for (const [index, courseMap] of remainingMaps.entries()) {
				const child = remainingChildren[index];
				if (child) {
					result.set(courseMap, child);
				}
			}
		}
		for (const courseMap of siblingMaps) {
			if (!result.has(courseMap)) {
				result.set(courseMap, parent);
			}
		}
	}
	return result;
}

function collectReaderTargets(reader: DocsReader): ReaderTarget[] {
	return reader.elements.flatMap((element, elementIndex) =>
		readerElementTarget(element, elementIndex),
	);
}

function readerElementTarget(element: DocsReaderElement, elementIndex: number): ReaderTarget[] {
	if (element.kind === "table") {
		return [];
	}
	return [
		{
			elementIndex,
			...(element.kind === "heading" ? { heading: element } : {}),
			rootUnitId: element.rootUnitId,
			title: element.text,
		},
	];
}

function collectHeadingChildren(reader: DocsReader, parent: ReaderTarget): ReaderTarget[] {
	const parentHeading = parent.heading;
	if (!parentHeading) {
		return [];
	}
	const children: ReaderTarget[] = [];
	for (let index = parent.elementIndex + 1; index < reader.elements.length; index += 1) {
		const element = reader.elements[index];
		if (element?.kind !== "heading") {
			continue;
		}
		if (element.level <= parentHeading.level) {
			break;
		}
		if (element.level === parentHeading.level + 1) {
			children.push({
				elementIndex: index,
				heading: element,
				rootUnitId: element.rootUnitId,
				title: element.text,
			});
		}
	}
	return children;
}

function displayCourseMapTitle(input: {
	documentTitle: string;
	parentTitle: string;
	sourceTitle: string;
	targetTitle: string;
}): string {
	const generic =
		normalizeComparableText(input.sourceTitle) === normalizeComparableText(input.parentTitle) ||
		normalizeComparableText(input.sourceTitle) === "课程地图";
	if (!generic) {
		return input.sourceTitle;
	}
	if (normalizeComparableText(input.targetTitle) !== normalizeComparableText(input.parentTitle)) {
		return `${stripHeadingPrefix(input.targetTitle)}课程地图`;
	}
	const documentSubject = input.documentTitle.replace(/(?:本科)?人才培养方案$/u, "").trim();
	return `${documentSubject || input.documentTitle}课程地图`;
}

function stripHeadingPrefix(value: string): string {
	return value
		.replace(
			/^(?:(?:第[一二三四五六七八九十百0-9]+(?:章|节|条))|(?:[一二三四五六七八九十百]+[、.])|(?:（[一二三四五六七八九十百0-9]+）)|(?:\d+\.(?!\d)))\s*/u,
			"",
		)
		.trim();
}

function headingSubject(value: string): string {
	return normalizeComparableText(stripHeadingPrefix(value));
}

function logicalCourseMapId(parts: SourceCourseMapBlock[]): string {
	return `course-map-${createHash("sha256")
		.update(parts.map((part) => part.blockId).join("\n"))
		.digest("hex")
		.slice(0, 12)}`;
}

function normalizeComparableText(value: string): string {
	return value.normalize("NFKC").replace(/\s+/gu, "").trim();
}

function requiredBoundingBox(
	value: unknown,
	field: string,
): readonly [number, number, number, number] {
	if (
		!Array.isArray(value) ||
		value.length !== 4 ||
		!value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
	) {
		throw new Error(`${field} must contain four finite numbers`);
	}
	const [left, top, right, bottom] = value as number[];
	if (!(left !== undefined && top !== undefined && right !== undefined && bottom !== undefined)) {
		throw new Error(`${field} is incomplete`);
	}
	if (!(right > left && bottom > top)) {
		throw new Error(`${field} must have positive area`);
	}
	return [left, top, right, bottom];
}

function requiredRelativeAssetPath(value: unknown, field: string): string {
	const path = requiredString(value, field).replaceAll("\\", "/");
	if (!path || path.startsWith("/") || path.split("/").includes("..")) {
		throw new Error(`${field} must be a safe relative path`);
	}
	return path;
}

function requiredPositiveInteger(value: unknown, field: string): number {
	if (!(typeof value === "number" && Number.isSafeInteger(value) && value > 0)) {
		throw new Error(`${field} must be a positive integer`);
	}
	return value;
}

function requiredString(value: unknown, field: string): string {
	const result = optionalString(value);
	if (!result) {
		throw new Error(`${field} must be a non-empty string`);
	}
	return result;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${field} must be an object`);
	}
	return value as Record<string, unknown>;
}
