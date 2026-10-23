import type {
	DocsReader as SourceDocsReader,
	DocsReaderElement as SourceDocsReaderElement,
	DocsReaderHeadingElement as SourceDocsReaderHeadingElement,
	DocsReaderTableCell as SourceDocsReaderTableCell,
	DocsReaderTableElement as SourceDocsReaderTableElement,
	DocsReaderTextElement as SourceDocsReaderTextElement,
} from "campus-contracts/campus-docs";
import { parseDocsReaderContract } from "campus-contracts/campus-docs";

export type DocsReaderPayload = SourceDocsReader;
export type DocsReaderElement = SourceDocsReaderElement;
export type DocsReaderHeadingElement = SourceDocsReaderHeadingElement;
export type DocsReaderTableCell = SourceDocsReaderTableCell;
export type DocsReaderTableElement = SourceDocsReaderTableElement;
export type DocsReaderTextElement = SourceDocsReaderTextElement;
export type DocsReaderBlock = DocsReaderTableElement | DocsReaderTextElement;

export interface DocsCourseMapPart {
	height: number;
	imageUrl: string;
	partId: string;
	width: number;
}

export interface DocsCourseMap {
	mapId: string;
	parts: DocsCourseMapPart[];
	targetRootUnitId: string;
	title: string;
}

export interface DocsReaderContent {
	courseMaps: DocsCourseMap[];
	reader: DocsReaderPayload;
}

export function parseDocsReaderPayload(value: unknown): DocsReaderPayload {
	return parseDocsReaderContract(value);
}

export async function loadDocsReaderContent(input: {
	readJson: (url: string) => Promise<unknown>;
	readerUrl: string;
}): Promise<DocsReaderContent> {
	const reader = parseDocsReaderPayload(await input.readJson(input.readerUrl));
	const courseMaps: DocsCourseMap[] = [];
	for (const supplement of reader.supplements) {
		const supplementUrl = resolveRelativeAssetUrl(input.readerUrl, supplement.path);
		courseMaps.push(
			...parseDocsCourseMapsForReader({
				manifestUrl: supplementUrl,
				reader,
				value: await input.readJson(supplementUrl),
			}),
		);
	}
	return { courseMaps, reader };
}

export function parseDocsCourseMapsForReader(input: {
	manifestUrl: string;
	reader: DocsReaderPayload;
	value: unknown;
}): DocsCourseMap[] {
	const parsed = parseCourseMaps(input.value, input.manifestUrl);
	if (parsed.docId !== input.reader.docId || parsed.versionId !== input.reader.versionId) {
		throw new Error("course maps identity does not match reader");
	}
	assertCourseMapTargets(input.reader, parsed.maps);
	return parsed.maps;
}

export function buildReaderDescription(reader: DocsReaderPayload, documentTitle: string): string {
	for (const element of reader.elements) {
		if (element.kind === "heading" || element.kind === "table") {
			continue;
		}
		return element.text.length > 150 ? `${element.text.slice(0, 147)}...` : element.text;
	}
	return `${documentTitle}的校园文档阅读页。`;
}

function parseCourseMaps(
	value: unknown,
	manifestUrl: string,
): { docId: string; maps: DocsCourseMap[]; versionId: string } {
	const record = requiredRecord(value, "course maps supplement");
	if (record.schemaVersion !== "campus_docs_course_maps.v1" || !Array.isArray(record.maps)) {
		throw new Error("course maps supplement schema is invalid");
	}
	return {
		docId: requiredString(record.docId, "course maps supplement docId"),
		maps: record.maps.map((item, index) => {
			const map = requiredRecord(item, `course maps supplement maps[${index}]`);
			if (!Array.isArray(map.parts) || map.parts.length === 0) {
				throw new Error(`course maps supplement maps[${index}].parts must not be empty`);
			}
			return {
				mapId: requiredString(map.mapId, `course maps supplement maps[${index}].mapId`),
				parts: map.parts.map((itemPart, partIndex) => {
					const part = requiredRecord(
						itemPart,
						`course maps supplement maps[${index}].parts[${partIndex}]`,
					);
					return {
						height: requiredPositiveInteger(
							part.height,
							`course maps supplement maps[${index}].parts[${partIndex}].height`,
						),
						imageUrl: resolveRelativeAssetUrl(
							manifestUrl,
							requiredRelativeAssetPath(
								part.imagePath,
								`course maps supplement maps[${index}].parts[${partIndex}].imagePath`,
							),
						),
						partId: requiredString(
							part.partId,
							`course maps supplement maps[${index}].parts[${partIndex}].partId`,
						),
						width: requiredPositiveInteger(
							part.width,
							`course maps supplement maps[${index}].parts[${partIndex}].width`,
						),
					};
				}),
				targetRootUnitId: requiredString(
					map.targetRootUnitId,
					`course maps supplement maps[${index}].targetRootUnitId`,
				),
				title: requiredString(map.title, `course maps supplement maps[${index}].title`),
			};
		}),
		versionId: requiredString(record.versionId, "course maps supplement versionId"),
	};
}

function assertCourseMapTargets(reader: DocsReaderPayload, courseMaps: DocsCourseMap[]): void {
	const rootUnitIds = new Set(reader.elements.map((element) => element.rootUnitId));
	for (const courseMap of courseMaps) {
		if (!rootUnitIds.has(courseMap.targetRootUnitId)) {
			throw new Error(`course map target is missing from reader: ${courseMap.targetRootUnitId}`);
		}
	}
}

function resolveRelativeAssetUrl(baseUrl: string, relativePath: string): string {
	const base = new URL(baseUrl, "https://campus.local");
	const resolved = new URL(relativePath, base);
	if (resolved.origin !== "https://campus.local") {
		throw new Error("reader supplement must resolve to a same-origin path");
	}
	return resolved.pathname;
}

function requiredRelativeAssetPath(value: unknown, field: string): string {
	const path = requiredString(value, field);
	if (
		path.startsWith("/") ||
		path.includes("\\") ||
		path
			.split("/")
			.some(
				(segment) =>
					!segment ||
					segment === "." ||
					segment === ".." ||
					segment.includes("?") ||
					segment.includes("#") ||
					hasControlCharacter(segment),
			)
	) {
		throw new Error(`${field} must be a safe relative path`);
	}
	return path;
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 0x20 || codePoint === 0x7f;
	});
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${field} must be an object`);
	}
	return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
	const normalized = optionalString(value);
	if (!normalized) {
		throw new Error(`${field} must be a non-empty string`);
	}
	return normalized;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredInteger(value: unknown, field: string): number {
	if (!(typeof value === "number" && Number.isSafeInteger(value))) {
		throw new Error(`${field} must be an integer`);
	}
	return value;
}

function requiredPositiveInteger(value: unknown, field: string): number {
	const integer = requiredInteger(value, field);
	if (integer < 1) {
		throw new Error(`${field} must be a positive integer`);
	}
	return integer;
}
