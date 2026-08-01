export interface DocsReaderTextElement {
	kind: "blockquote" | "list" | "paragraph";
	rootUnitId: string;
	text: string;
}

export interface DocsReaderTableCell {
	colSpan?: number;
	header: boolean;
	rowSpan?: number;
	text: string;
}

export interface DocsReaderTableElement {
	kind: "table";
	rootUnitId: string;
	rows: DocsReaderTableCell[][];
}

export interface DocsReaderHeadingElement {
	anchor: string;
	kind: "heading";
	level: 2 | 3 | 4 | 5 | 6;
	rootUnitId: string;
	text: string;
}

export type DocsReaderBlock = DocsReaderTableElement | DocsReaderTextElement;
export type DocsReaderElement = DocsReaderBlock | DocsReaderHeadingElement;

export interface DocsReaderSupplement {
	kind: "course_maps";
	path: "course-maps.json";
}

export interface DocsReaderPayload {
	docId: string;
	elements: DocsReaderElement[];
	schemaVersion: "campus_docs_reader.v3";
	supplements: DocsReaderSupplement[];
	versionId: string;
}

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
	const record = requiredRecord(value, "reader");
	if (record.schemaVersion !== "campus_docs_reader.v3" || !Array.isArray(record.elements)) {
		throw new Error("reader schema is invalid");
	}
	const elements = record.elements.map((element, index) =>
		parseReaderElement(element, `reader.elements[${index}]`),
	);
	assertReaderElementIdentity(elements);
	return {
		docId: requiredString(record.docId, "reader.docId"),
		elements,
		schemaVersion: "campus_docs_reader.v3",
		supplements: parseReaderSupplements(record.supplements),
		versionId: requiredString(record.versionId, "reader.versionId"),
	};
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

function parseReaderElement(value: unknown, label: string): DocsReaderElement {
	const record = requiredRecord(value, label);
	const kind = requiredString(record.kind, `${label}.kind`);
	const rootUnitId = requiredString(record.rootUnitId, `${label}.rootUnitId`);
	if (kind === "heading") {
		const level = requiredInteger(record.level, `${label}.level`);
		if (level < 2 || level > 6) {
			throw new Error(`${label}.level must be between 2 and 6`);
		}
		return {
			anchor: requiredString(record.anchor, `${label}.anchor`),
			kind,
			level: level as DocsReaderHeadingElement["level"],
			rootUnitId,
			text: requiredString(record.text, `${label}.text`),
		};
	}
	if (kind === "table") {
		if (!Array.isArray(record.rows) || record.rows.length === 0) {
			throw new Error(`${label}.rows must be a non-empty array`);
		}
		return {
			kind,
			rootUnitId,
			rows: record.rows.map((row, rowIndex) => {
				if (!Array.isArray(row) || row.length === 0) {
					throw new Error(`${label}.rows[${rowIndex}] must be a non-empty array`);
				}
				return row.map((cell, cellIndex) =>
					parseTableCell(cell, `${label}.rows[${rowIndex}][${cellIndex}]`),
				);
			}),
		};
	}
	if (kind !== "paragraph" && kind !== "list" && kind !== "blockquote") {
		throw new Error(`${label}.kind is unsupported`);
	}
	return {
		kind,
		rootUnitId,
		text: requiredString(record.text, `${label}.text`),
	};
}

function assertReaderElementIdentity(elements: DocsReaderElement[]): void {
	const anchors = new Set<string>();
	const rootUnitIds = new Set<string>();
	for (const element of elements) {
		if (rootUnitIds.has(element.rootUnitId)) {
			throw new Error(`reader rootUnitId is duplicated: ${element.rootUnitId}`);
		}
		rootUnitIds.add(element.rootUnitId);
		if (element.kind === "heading") {
			if (anchors.has(element.anchor)) {
				throw new Error(`reader heading anchor is duplicated: ${element.anchor}`);
			}
			anchors.add(element.anchor);
		}
	}
}

function parseTableCell(value: unknown, label: string): DocsReaderTableCell {
	const record = requiredRecord(value, label);
	if (typeof record.header !== "boolean") {
		throw new Error(`${label}.header must be a boolean`);
	}
	return {
		...(record.colSpan === undefined
			? {}
			: { colSpan: requiredPositiveInteger(record.colSpan, `${label}.colSpan`) }),
		header: record.header,
		...(record.rowSpan === undefined
			? {}
			: { rowSpan: requiredPositiveInteger(record.rowSpan, `${label}.rowSpan`) }),
		text: typeof record.text === "string" ? record.text : "",
	};
}

function parseReaderSupplements(value: unknown): DocsReaderSupplement[] {
	if (!Array.isArray(value)) {
		throw new Error("reader.supplements must be an array");
	}
	return value.map((item, index) => {
		const record = requiredRecord(item, `reader.supplements[${index}]`);
		if (record.kind !== "course_maps" || record.path !== "course-maps.json") {
			throw new Error(`reader.supplements[${index}] is unsupported`);
		}
		return {
			kind: "course_maps",
			path: "course-maps.json",
		};
	});
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
