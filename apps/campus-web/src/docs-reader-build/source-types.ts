export interface ObjectRef {
	byteSize: number;
	key: string;
	sha256: `sha256:${string}`;
}

export interface DocsCollection {
	collection: string;
	corpus: string;
	description: string | null;
	displayName: string;
}

export interface DocsTopic {
	corpus: string;
	description: string | null;
	displayName: string;
	order: number;
	topicId: string;
}

export interface DocsRedirect {
	fromPath: string;
	statusCode: 308;
	toPath: string;
}

export interface DocsDocument {
	collection: string;
	corpus: string;
	currentVersionId: string;
	currentVersionSlug: string;
	docId: string;
	documentSlug: string;
	title: string;
	topicId: string | null;
}

export interface DocsSupplementAsset {
	object: ObjectRef;
	path: string;
}

export interface DocsSupplement {
	assets: DocsSupplementAsset[];
	kind: "course_maps";
	object: ObjectRef;
	path: "course-maps.json";
}

export interface DocsSourceVersion {
	docId: string;
	effectiveFrom: string | null;
	isCurrent: boolean;
	label: string;
	reader: ObjectRef;
	sourceLabel: string;
	supplements: DocsSupplement[];
	updatedAt: string;
	versionId: string;
	versionSlug: string;
}

export interface DocsSourceManifest {
	collections: DocsCollection[];
	documents: DocsDocument[];
	redirects: DocsRedirect[];
	schemaVersion: "campus_docs_source.v3";
	topics: DocsTopic[];
	versions: DocsSourceVersion[];
}

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

export type DocsReaderElement =
	| DocsReaderHeadingElement
	| DocsReaderTableElement
	| DocsReaderTextElement;

export interface DocsReader {
	docId: string;
	elements: DocsReaderElement[];
	schemaVersion: "campus_docs_reader.v3";
	supplements: Array<{ kind: "course_maps"; path: "course-maps.json" }>;
	versionId: string;
}

export interface DocsCourseMapPart {
	height: number;
	imagePath: string;
	partId: string;
	width: number;
}

export interface DocsCourseMap {
	mapId: string;
	parts: DocsCourseMapPart[];
	targetRootUnitId: string;
	title: string;
}

export interface DocsCourseMaps {
	docId: string;
	maps: DocsCourseMap[];
	schemaVersion: "campus_docs_course_maps.v1";
	versionId: string;
}
