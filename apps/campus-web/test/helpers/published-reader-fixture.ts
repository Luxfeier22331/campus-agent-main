import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import type {
	PublishedObjectRef,
	PublishedReaderManifest,
	PublishedReaderSupplement,
	ReaderObjectStoreClient,
} from "../../src/docs-reader-build/published-reader-types.ts";

export interface PublishedReaderFixtureInput {
	missingObjects?: string[];
	omitPublicReaderSupplement?: boolean;
	publicCollection?: string;
	publicCollectionLabel?: string;
	publicCourseMapParentKind?: "heading" | "paragraph";
	publicCorpus?: string;
	publicDocumentSlug?: string;
	publicReaderAnchor?: string;
	publicReaderDocId?: string;
	publicReaderRootUnitId?: string;
	publicReaderVersionId?: string;
	publicSectionTitle?: string;
}

export interface PublishedReaderFixture {
	client: ReaderObjectStoreClient;
	manifest: PublishedReaderManifest;
	root: string;
}

let tempDir: string | null = null;

type FixtureObject = string | Uint8Array;

export const COURSE_MAP_IMAGE = createPngImage(1233, 649);

export function cleanupPublishedReaderFixture(): void {
	if (tempDir) {
		rmSync(tempDir, { force: true, recursive: true });
		tempDir = null;
	}
}

export function createPublishedReaderFixture(
	input: PublishedReaderFixtureInput = {},
): PublishedReaderFixture {
	cleanupPublishedReaderFixture();
	tempDir = mkdtempSync(join(tmpdir(), "campus-docs-sync-"));
	const root = tempDir;
	const objects = new Map<string, FixtureObject>();
	const addObject = (key: string, value: FixtureObject) => {
		objects.set(key, value);
		return objectRef(key, value);
	};

	const publicDocumentSlug = input.publicDocumentSlug ?? "student-attendance";
	const publicCollection = input.publicCollection ?? "student_rules";
	const publicCollectionLabel = input.publicCollectionLabel ?? "学生手册";
	const publicCorpus = input.publicCorpus ?? "regulations";
	const publicTopicId = publicCorpus === "regulations" ? "student-life" : null;
	const publicRouteSlug = routeSlug(publicDocumentSlug);
	const publicReaderAnchor = input.publicReaderAnchor ?? "general";
	const publicReaderRootUnitId = input.publicReaderRootUnitId ?? "attendance-root";
	const publicReader = buildPublicReader({
		anchor: publicReaderAnchor,
		courseMapParentKind: input.publicCourseMapParentKind ?? "heading",
		docId: input.publicReaderDocId ?? "doc_public",
		includeSupplement: !input.omitPublicReaderSupplement,
		rootUnitId: publicReaderRootUnitId,
		sectionTitle: input.publicSectionTitle ?? "文档正文",
		versionId: input.publicReaderVersionId ?? "version_public",
	});
	const publicHistoryReader = buildPublicReader({
		anchor: publicReaderAnchor,
		bodyText: "2025 版测试正文：学生应按历史规定参加教学活动。",
		courseMapParentKind: input.publicCourseMapParentKind ?? "heading",
		docId: "doc_public",
		includeSupplement: true,
		rootUnitId: publicReaderRootUnitId,
		sectionTitle: input.publicSectionTitle ?? "文档正文",
		versionId: "version_public_history",
	});
	const secondaryReader = JSON.stringify({
		docId: "doc_secondary",
		elements: [
			{
				anchor: "leave-policy",
				kind: "heading",
				level: 2,
				rootUnitId: "leave-policy-heading",
				text: "请假手续",
			},
			{
				kind: "paragraph",
				rootUnitId: "leave-policy-root",
				text: "学生请假应按规定办理手续。",
			},
		],
		schemaVersion: "campus_docs_reader.v3",
		supplements: [],
		versionId: "version_secondary",
	});
	const publicReaderRef = addObject("reader/public.json", publicReader);
	const publicHistoryReaderRef = addObject("reader/public-history.json", publicHistoryReader);
	const secondaryReaderRef = addObject("reader/secondary.json", secondaryReader);
	const courseMapsRef = addObject(
		"supplements/public-course-maps.json",
		courseMapsFixture("doc_public", "version_public"),
	);
	const historyCourseMapsRef = addObject(
		"supplements/public-history-course-maps.json",
		courseMapsFixture("doc_public", "version_public_history"),
	);
	const courseMapImageRef = addObject("supplements/public-course-map-image.png", COURSE_MAP_IMAGE);
	const publicSupplements: PublishedReaderSupplement[] = [
		{
			assets: [
				{
					object: courseMapImageRef,
					path: "course-maps/page-0001-map-01.png",
				},
			],
			kind: "course_maps",
			object: courseMapsRef,
			path: "course-maps.json",
		},
	];
	const publicHistorySupplements = [
		{
			...publicSupplements[0],
			object: historyCourseMapsRef,
		},
	];
	const manifest: PublishedReaderManifest = {
		collections: [
			{
				collection: publicCollection,
				corpus: publicCorpus,
				description: "学生在校期间适用的规章制度。",
				displayName: publicCollectionLabel,
			},
		],
		redirects: [],
		entries: [
			{
				collection: publicCollection,
				corpus: publicCorpus,
				docId: "doc_public",
				documentSlug: publicDocumentSlug,
				effectiveFrom: "2026-01-01",
				isCurrent: true,
				reader: publicReaderRef,
				routeSlug: publicRouteSlug,
				sourceLabel: publicCollectionLabel,
				supplements: publicSupplements,
				title: "中央民族大学学生考勤管理规定",
				topicId: publicTopicId,
				updatedAt: "2026-07-26T00:00:00.000Z",
				versionId: "version_public",
				versionLabel: "现行版",
				versionSlug: "2026-current",
			},
			{
				collection: publicCollection,
				corpus: publicCorpus,
				docId: "doc_public",
				documentSlug: publicDocumentSlug,
				effectiveFrom: "2025-01-01",
				isCurrent: false,
				reader: publicHistoryReaderRef,
				routeSlug: publicRouteSlug,
				sourceLabel: publicCollectionLabel,
				supplements: publicHistorySupplements,
				title: "中央民族大学学生考勤管理规定",
				topicId: publicTopicId,
				updatedAt: "2025-07-26T00:00:00.000Z",
				versionId: "version_public_history",
				versionLabel: "2025 版",
				versionSlug: "2025-history",
			},
			{
				collection: publicCollection,
				corpus: publicCorpus,
				docId: "doc_secondary",
				documentSlug: "leave-policy",
				effectiveFrom: null,
				isCurrent: true,
				reader: secondaryReaderRef,
				routeSlug: "leave-policy",
				sourceLabel: publicCollectionLabel,
				supplements: [],
				title: "学生请假管理规定",
				topicId: publicTopicId,
				updatedAt: "2026-07-26T00:00:00.000Z",
				versionId: "version_secondary",
				versionLabel: "现行版",
				versionSlug: "2026-current",
			},
		],
		topics: publicTopicId
			? [
					{
						corpus: publicCorpus,
						description: "学生在校期间常用的管理规定。",
						displayName: "校园生活",
						order: 1,
						topicId: publicTopicId,
					},
				]
			: [],
	};
	const missingObjects = new Set(input.missingObjects ?? []);
	return {
		client: {
			async readOptionalBytesObject({ key }) {
				if (missingObjects.has(key)) {
					return;
				}
				const value = objects.get(key);
				return value === undefined ? undefined : toBytes(value);
			},
		},
		manifest,
		root,
	};
}

function buildPublicReader(input: {
	anchor: string;
	bodyText?: string;
	courseMapParentKind: "heading" | "paragraph";
	docId: string;
	includeSupplement: boolean;
	rootUnitId: string;
	sectionTitle: string;
	versionId: string;
}): string {
	const contentBlocks = [
		{
			kind: "paragraph",
			rootUnitId: input.rootUnitId,
			text: input.bodyText ?? "学生应按时参加教学活动。",
		},
		{
			kind: "paragraph",
			rootUnitId: "regular-enumeration",
			text: "一、这是一条普通正文，不应自动升级为标题。",
		},
		{
			kind: "table",
			rootUnitId: "activity-credit-table",
			rows: [
				[
					{ header: true, text: "活动名称" },
					{ header: true, text: "学分" },
				],
				[
					{ header: false, text: "校级社会实践" },
					{ header: false, text: "1" },
				],
				[
					{ header: false, text: "*战场医疗救护" },
					{ header: false, rowSpan: 2, text: "0.5" },
				],
				[{ header: false, text: "志愿服务" }],
			],
		},
		{
			kind: "paragraph",
			rootUnitId: "unsafe-html-text",
			text: "<img src=x onerror=alert(1)>",
		},
		...(input.courseMapParentKind === "paragraph"
			? [
					{
						kind: "paragraph",
						rootUnitId: "course-map-heading",
						text: "六、课程地图",
					},
				]
			: []),
	];
	return JSON.stringify({
		docId: input.docId,
		elements: [
			{
				anchor: input.anchor,
				kind: "heading",
				level: 2,
				rootUnitId: `${input.rootUnitId}-heading`,
				text: input.sectionTitle,
			},
			...contentBlocks,
			...(input.courseMapParentKind === "heading"
				? [
						{
							anchor: "course-map-heading",
							kind: "heading",
							level: 2,
							rootUnitId: "course-map-heading",
							text: "六、课程地图",
						},
					]
				: []),
		],
		schemaVersion: "campus_docs_reader.v3",
		supplements: input.includeSupplement ? [{ kind: "course_maps", path: "course-maps.json" }] : [],
		versionId: input.versionId,
	});
}

function objectRef(key: string, value: FixtureObject): PublishedObjectRef {
	const bytes = toBytes(value);
	return {
		byteSize: bytes.byteLength,
		key,
		sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
	};
}

function courseMapsFixture(docId: string, versionId: string): string {
	return JSON.stringify({
		docId,
		maps: [
			{
				mapId: "course-map-page-0001-map-01",
				parts: [
					{
						height: 649,
						imagePath: "course-maps/page-0001-map-01.png",
						partId: "page-0001-map-01",
						width: 1233,
					},
				],
				targetRootUnitId: "course-map-heading",
				title: "学生考勤课程地图",
			},
		],
		schemaVersion: "campus_docs_course_maps.v1",
		versionId,
	});
}

function routeSlug(documentSlug: string): string {
	return /^[A-Za-z0-9][A-Za-z0-9._~-]*$/u.test(documentSlug)
		? documentSlug
		: `doc-${createHash("sha256").update(documentSlug).digest("hex").slice(0, 12)}`;
}

function createPngImage(width: number, height: number): Uint8Array {
	const rowSize = width + 1;
	const raw = Buffer.alloc(rowSize * height, 232);
	for (let row = 0; row < height; row += 1) {
		raw[row * rowSize] = 0;
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 0;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		createPngChunk("IHDR", ihdr),
		createPngChunk("IDAT", deflateSync(raw)),
		createPngChunk("IEND", Buffer.alloc(0)),
	]);
}

function createPngChunk(type: string, data: Uint8Array): Buffer {
	const typeBytes = Buffer.from(type, "ascii");
	const dataBytes = Buffer.from(data);
	const chunk = Buffer.alloc(12 + dataBytes.length);
	chunk.writeUInt32BE(dataBytes.length, 0);
	typeBytes.copy(chunk, 4);
	dataBytes.copy(chunk, 8);
	chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, dataBytes])), 8 + dataBytes.length);
	return chunk;
}

function crc32(bytes: Uint8Array): number {
	let value = 0xffffffff;
	for (const byte of bytes) {
		value ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
		}
	}
	return (value ^ 0xffffffff) >>> 0;
}

function toBytes(value: FixtureObject): Uint8Array {
	return typeof value === "string" ? new TextEncoder().encode(value) : value;
}
