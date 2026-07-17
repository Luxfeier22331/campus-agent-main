import {
	resolvePublishedReaderSourceObjectKey,
	resolvePublishedReaderTargetObjectByDeliveryMode,
} from "./published-reader-assets.ts";
import { escapeAttribute, escapeHtml, normalizeText } from "./published-reader-text.ts";
import type {
	CourseMapBlock,
	CourseMapsByHeading,
	PublishedReaderManifestEntry,
	ReaderDocumentPayload,
	ReaderObjectStoreClient,
} from "./published-reader-types.ts";

export async function loadReaderCourseMapSupplements(input: {
	client: ReaderObjectStoreClient;
	entry: PublishedReaderManifestEntry;
	reader: ReaderDocumentPayload;
}): Promise<CourseMapBlock[]> {
	const supplements = Array.isArray(input.reader.supplements) ? input.reader.supplements : [];
	const courseMapSupplement = supplements.find(
		(supplement) =>
			supplement &&
			typeof supplement === "object" &&
			!Array.isArray(supplement) &&
			supplement.kind === "course_maps",
	);
	if (!courseMapSupplement) {
		return [];
	}
	const supplementPath = normalizeReaderAssetRelativePath(
		courseMapSupplement.path,
		"course map supplement path",
	);
	const payload = JSON.parse(
		await input.client.readTextObject({
			key: resolvePublishedReaderSourceObjectKey(input.entry, supplementPath),
		}),
	);
	return normalizeCourseMapSupplement({ entry: input.entry, payload });
}

export function buildCourseMapsByHeading(courseMaps: CourseMapBlock[]): CourseMapsByHeading {
	const byHeading: CourseMapsByHeading = new Map();
	for (const courseMap of courseMaps) {
		byHeading.set(courseMap.parentHeadingHint, [
			...(byHeading.get(courseMap.parentHeadingHint) ?? []),
			courseMap,
		]);
	}
	return byHeading;
}

export function countUnrenderedCourseMaps(courseMapsByHeading: CourseMapsByHeading): number {
	return [...courseMapsByHeading.values()].reduce((total, maps) => total + maps.length, 0);
}

export function renderCourseMapFigure(courseMap: CourseMapBlock): string {
	const caption = courseMap.title === courseMap.parentHeadingHint ? "" : courseMap.title;
	return [
		`<figure className="docs-course-map-figure" data-docs-course-map-id="${escapeAttribute(courseMap.blockId)}">`,
		`\t<div className="docs-course-map-frame" role="region" aria-label="${escapeAttribute(courseMap.title)}" tabIndex={0}>`,
		`\t\t<img className="docs-course-map-image" src="${escapeAttribute(courseMap.targetUrl)}" alt="${escapeAttribute(courseMap.title)}" loading="lazy" decoding="async" />`,
		"\t</div>",
		...(caption ? [`\t<figcaption>${escapeHtml(caption)}</figcaption>`] : []),
		"</figure>",
	].join("\n");
}

function normalizeCourseMapSupplement(input: {
	entry: PublishedReaderManifestEntry;
	payload: unknown;
}): CourseMapBlock[] {
	const payload = input.payload as {
		blocks?: unknown;
		schemaVersion?: unknown;
	};
	if (
		!payload ||
		typeof payload !== "object" ||
		Array.isArray(payload) ||
		payload.schemaVersion !== "curriculum_course_maps_reader_v1" ||
		!Array.isArray(payload.blocks)
	) {
		throw new Error(`unsupported course map supplement: ${input.entry.documentSlug}`);
	}
	return payload.blocks.map((block) => normalizeCourseMapBlock({ block, entry: input.entry }));
}

function normalizeCourseMapBlock(input: {
	block: unknown;
	entry: PublishedReaderManifestEntry;
}): CourseMapBlock {
	const block = input.block;
	if (!block || typeof block !== "object" || Array.isArray(block)) {
		throw new Error(`course map block must be an object: ${input.entry.documentSlug}`);
	}
	const record = block as Record<string, unknown>;
	const blockId = normalizeText(record.blockId);
	const parentHeadingHint = normalizeText(record.parentHeadingHint);
	const imagePath = normalizeReaderAssetRelativePath(record.imagePath, "course map image path");
	if (!(blockId && parentHeadingHint)) {
		throw new Error(
			`course map block requires blockId and parentHeadingHint: ${input.entry.documentSlug}`,
		);
	}
	const targetObject = input.entry.targetObjects[imagePath];
	if (!targetObject) {
		throw new Error(`missing course map target object: ${imagePath}`);
	}
	const targetUrl = `/${resolvePublishedReaderTargetObjectByDeliveryMode(
		input.entry.deliveryMode,
		targetObject,
	)}`;
	const title = normalizeText(record.title) || parentHeadingHint;
	return {
		blockId,
		parentHeadingHint,
		targetUrl,
		title,
	};
}

function normalizeReaderAssetRelativePath(value: unknown, label: string): string {
	const path = normalizeText(value).replaceAll("\\", "/");
	if (!path || path.startsWith("/") || path.split("/").includes("..")) {
		throw new Error(`invalid ${label}`);
	}
	return path;
}
