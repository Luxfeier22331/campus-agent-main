import {
	resolvePublishedReaderSourceObjectKey,
	resolvePublishedReaderTargetObjectByDeliveryMode,
} from "./published-reader-assets.mjs";
import { escapeAttribute, escapeHtml, normalizeText } from "./published-reader-text.mjs";

export async function loadReaderCourseMapSupplements(input) {
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

export function buildCourseMapsByHeading(courseMaps) {
	const byHeading = new Map();
	for (const courseMap of courseMaps) {
		byHeading.set(courseMap.parentHeadingHint, [
			...(byHeading.get(courseMap.parentHeadingHint) ?? []),
			courseMap,
		]);
	}
	return byHeading;
}

export function countUnrenderedCourseMaps(courseMapsByHeading) {
	return [...courseMapsByHeading.values()].reduce((total, maps) => total + maps.length, 0);
}

export function renderCourseMapFigure(courseMap) {
	const caption = courseMap.title === courseMap.parentHeadingHint ? "" : courseMap.title;
	return [
		`<figure className="docs-course-map-figure" data-docs-course-map-id="${escapeAttribute(courseMap.blockId)}">`,
		'\t<div className="docs-course-map-frame">',
		`\t\t<img className="docs-course-map-image" src="${escapeAttribute(courseMap.targetUrl)}" alt="${escapeAttribute(courseMap.title)}" loading="lazy" decoding="async" />`,
		"\t</div>",
		...(caption ? [`\t<figcaption>${escapeHtml(caption)}</figcaption>`] : []),
		"</figure>",
	].join("\n");
}

function normalizeCourseMapSupplement(input) {
	if (
		!input.payload ||
		typeof input.payload !== "object" ||
		Array.isArray(input.payload) ||
		input.payload.schemaVersion !== "curriculum_course_maps_reader_v1" ||
		!Array.isArray(input.payload.blocks)
	) {
		throw new Error(`unsupported course map supplement: ${input.entry.documentSlug}`);
	}
	return input.payload.blocks.map((block) =>
		normalizeCourseMapBlock({ block, entry: input.entry }),
	);
}

function normalizeCourseMapBlock(input) {
	const block = input.block;
	if (!block || typeof block !== "object" || Array.isArray(block)) {
		throw new Error(`course map block must be an object: ${input.entry.documentSlug}`);
	}
	const blockId = normalizeText(block.blockId);
	const parentHeadingHint = normalizeText(block.parentHeadingHint);
	const imagePath = normalizeReaderAssetRelativePath(block.imagePath, "course map image path");
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
	const title = normalizeText(block.title) || parentHeadingHint;
	return {
		blockId,
		parentHeadingHint,
		targetUrl,
		title,
	};
}

function normalizeReaderAssetRelativePath(value, label) {
	const path = normalizeText(value).replaceAll("\\", "/");
	if (!path || path.startsWith("/") || path.split("/").includes("..")) {
		throw new Error(`invalid ${label}`);
	}
	return path;
}
