import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import { DOCS_SOURCE_KEY, normalizeSourceManifest } from "../src/campus-docs-node.ts";
import type {
	DocsDocument,
	DocsSourceManifest,
	DocsSourceVersion,
	ObjectRef,
} from "../src/campus-docs-types.ts";

export const COURSE_MAP_IMAGE = createPngImage(1233, 649);

export interface DocsSourceFixtureClient {
	readOptionalBytesObject(input: { key: string }): Promise<Uint8Array | undefined>;
}

export interface DocsSourceFixtureObject {
	body: Uint8Array;
	contentType: string;
}

export interface DocsSourceFixture {
	client: DocsSourceFixtureClient;
	objects: ReadonlyMap<string, DocsSourceFixtureObject>;
	source: DocsSourceManifest;
	sourceBytes: Uint8Array;
	sourceDigest: `sha256:${string}`;
}

export const DOCS_SOURCE_SITE_FIXTURE = {
	attendance: {
		anchors: {
			body: "document-body",
			courseMap: "course-map",
		},
		latestVersionSlug: "2026",
		documentSlug: "doc-c62077b20430",
		historicalVersionSlug: "2025",
		path: "/docs/regulations/student_rules/doc-c62077b20430",
		rootUnitIds: {
			body: "attendance-root",
			courseMap: "course-map-heading",
		},
	},
} as const;

export function createDocsSourceSiteFixture(): DocsSourceFixture {
	const objects = new Map<string, DocsSourceFixtureObject>();
	const addObject = (key: string, value: unknown, format: "bytes" | "json" = "json") => {
		const bytes = format === "bytes" ? (value as Uint8Array) : canonicalJsonBytes(value);
		objects.set(key, {
			body: bytes,
			contentType: format === "bytes" ? "image/png" : "application/json",
		});
		return objectRef(key, bytes);
	};
	const collections = [
		{
			collection: "undergraduate",
			corpus: "curriculum",
			description: "本科阶段的培养方案与课程计划。",
			displayName: "本科培养方案",
		},
		{
			collection: "second_degree",
			corpus: "curriculum",
			description: "二学位阶段的培养方案与课程计划。",
			displayName: "二学位培养方案",
		},
		{
			collection: "general_education",
			corpus: "curriculum",
			description: "通识教育课程与修读要求。",
			displayName: "通识教育",
		},
		{
			collection: "institutional_rules",
			corpus: "regulations",
			description: "学校层面的正式规章制度。",
			displayName: "校级规章",
		},
		{
			collection: "scoped_rules",
			corpus: "regulations",
			description: "专项事务适用的规章制度。",
			displayName: "专项规章",
		},
		{
			collection: "student_rules",
			corpus: "regulations",
			description: "学生在校期间适用的管理规定。",
			displayName: "学生手册",
		},
	];
	const topics = [
		{
			corpus: "regulations",
			description: "学校治理与综合事务的正式规定。",
			displayName: "学校治理",
			order: 1,
			topicId: "institutional-governance",
		},
		{
			corpus: "regulations",
			description: "教学、科研与专项工作的办理规则。",
			displayName: "教学与专项事务",
			order: 2,
			topicId: "academic-services",
		},
		{
			corpus: "regulations",
			description: "学生在校期间常用的管理规定。",
			displayName: "校园生活",
			order: 3,
			topicId: "student-life",
		},
	];
	const topicByCollection = new Map([
		["institutional_rules", "institutional-governance"],
		["scoped_rules", "academic-services"],
		["student_rules", "student-life"],
	]);
	const documents: DocsDocument[] = [];
	const versions: DocsSourceVersion[] = [];
	const courseMapImage = addObject("fixtures/docs/course-map.png", COURSE_MAP_IMAGE, "bytes");

	for (const collection of collections) {
		for (let ordinal = 1; ordinal <= 4; ordinal += 1) {
			const isAttendanceDocument =
				collection.corpus === "regulations" &&
				collection.collection === "student_rules" &&
				ordinal === 1;
			const documentSlug = isAttendanceDocument
				? DOCS_SOURCE_SITE_FIXTURE.attendance.documentSlug
				: `${collection.collection}-fixture-${ordinal}`;
			const docId = isAttendanceDocument
				? "doc_site_attendance"
				: `doc_${collection.collection}_${ordinal}`;
			const latestVersionId = `${docId}_current`;
			const title = isAttendanceDocument
				? "中央民族大学学生考勤管理规定"
				: `${collection.displayName}示例文档 ${ordinal}`;
			const topicId = topicByCollection.get(collection.collection) ?? null;
			documents.push({
				collection: collection.collection,
				corpus: collection.corpus,
				docId,
				documentSlug,
				title,
				topicId,
			});
			versions.push(
				createVersion({
					addObject,
					courseMapImage,
					docId,
					includeCourseMap: isAttendanceDocument,
					includeTable:
						isAttendanceDocument || (collection.collection === "undergraduate" && ordinal === 1),
					useLatestContent: true,
					title,
					versionId: latestVersionId,
					versionSlug: DOCS_SOURCE_SITE_FIXTURE.attendance.latestVersionSlug,
				}),
			);

			if (
				ordinal === 1 &&
				(collection.collection === "undergraduate" ||
					collection.collection === "institutional_rules" ||
					collection.collection === "student_rules")
			) {
				versions.push(
					createVersion({
						addObject,
						courseMapImage,
						docId,
						includeCourseMap: isAttendanceDocument,
						includeTable: false,
						useLatestContent: false,
						title,
						versionId: `${docId}_history`,
						versionSlug: DOCS_SOURCE_SITE_FIXTURE.attendance.historicalVersionSlug,
					}),
				);
			}
		}
	}

	const source = normalizeSourceManifest({
		collections,
		documents,
		redirects: [
			{
				fromPath: "/docs/regulations/student_rules/retired-attendance",
				statusCode: 308,
				toPath: DOCS_SOURCE_SITE_FIXTURE.attendance.path,
			},
		],
		schemaVersion: "campus_docs_source.v4",
		topics,
		versions,
	});
	const sourceBytes = canonicalJsonBytes(source);
	objects.set(DOCS_SOURCE_KEY, { body: sourceBytes, contentType: "application/json" });
	return {
		client: {
			async readOptionalBytesObject({ key }) {
				return objects.get(key)?.body;
			},
		},
		objects,
		source,
		sourceBytes,
		sourceDigest: sha256(sourceBytes),
	};
}

function createVersion(input: {
	addObject: (key: string, value: unknown, format?: "bytes" | "json") => ObjectRef;
	courseMapImage: ObjectRef;
	docId: string;
	includeCourseMap: boolean;
	includeTable: boolean;
	useLatestContent: boolean;
	title: string;
	versionId: string;
	versionSlug: string;
}): DocsSourceVersion {
	const supplements = input.includeCourseMap
		? [
				{
					assets: [
						{
							object: input.courseMapImage,
							path: "course-maps/page-0001-map-01.png",
						},
					],
					kind: "course_maps" as const,
					object: input.addObject(`fixtures/docs/course-maps/${input.versionId}.json`, {
						blocks: [
							{
								blockId: "page-0001-map-01",
								imagePath: "course-maps/page-0001-map-01.png",
								pageNumber: 1,
								parentHeadingHint: "六、课程地图",
								regionBBoxProvider: [0, 0, 1233, 649],
								title: "学生考勤课程地图",
							},
						],
						docId: input.docId,
						schemaVersion: "curriculum_course_maps_reader_v1",
						versionId: input.versionId,
					}),
					path: "course-maps.json" as const,
				},
			]
		: [];
	const reader = input.addObject(`fixtures/docs/readers/${input.versionId}.json`, {
		docId: input.docId,
		elements: input.includeCourseMap ? attendanceElements(input) : standardElements(input),
		schemaVersion: "campus_docs_reader.v3",
		supplements: supplements.map(({ kind, path }) => ({ kind, path })),
		versionId: input.versionId,
	});
	return {
		docId: input.docId,
		reader,
		supplements,
		versionId: input.versionId,
		versionSlug: input.versionSlug,
	};
}

function attendanceElements(input: {
	docId: string;
	includeTable: boolean;
	useLatestContent: boolean;
	title: string;
	versionId: string;
}): unknown[] {
	return [
		{
			anchor: DOCS_SOURCE_SITE_FIXTURE.attendance.anchors.body,
			kind: "heading",
			level: 2,
			rootUnitId: "attendance-root-heading",
			text: "文档正文",
		},
		{
			kind: "paragraph",
			rootUnitId: DOCS_SOURCE_SITE_FIXTURE.attendance.rootUnitIds.body,
			text: input.useLatestContent
				? "学生应按时参加教学活动。"
				: "2025 版测试正文：学生应按历史规定参加教学活动。",
		},
		{
			kind: "paragraph",
			rootUnitId: "regular-enumeration",
			text: "一、这是一条普通正文，不应自动升级为标题。",
		},
		{
			kind: "list",
			rootUnitId: "attendance-list",
			text: "按时参加教学活动\n按要求履行请假手续",
		},
		{
			kind: "blockquote",
			rootUnitId: "attendance-quote",
			text: "具体要求以当前公开版本为准。",
		},
		{
			anchor: "attendance-requirements",
			kind: "heading",
			level: 3,
			rootUnitId: "attendance-requirements-heading",
			text: "教学活动要求",
		},
		{
			anchor: "attendance-leave-process",
			kind: "heading",
			level: 4,
			rootUnitId: "attendance-leave-process-heading",
			text: "请假手续",
		},
		...(input.includeTable
			? [
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
								{ header: false, text: "战场医疗救护" },
								{ header: false, rowSpan: 2, text: "0.5" },
							],
							[{ header: false, text: "志愿服务" }],
							[
								{ header: false, text: "创新项目" },
								{ header: false, text: "" },
							],
						],
					},
					{
						kind: "table",
						rootUnitId: "wide-course-table",
						rows: [
							[
								"课程编号",
								"课程名称",
								"课程类别",
								"课程性质",
								"学分",
								"总学时",
								"讲授学时",
								"实验学时",
								"实践学时",
								"开课学期",
								"考核方式",
								"备注",
							].map((text) => ({ header: true, text })),
							[
								"TEST1001",
								"校园公共基础课程",
								"公共基础课",
								"必修",
								"2",
								"32",
								"24",
								"4",
								"4",
								"第一学期",
								"考试",
								"测试数据",
							].map((text) => ({ header: false, text })),
						],
					},
				]
			: []),
		{
			kind: "paragraph",
			rootUnitId: "unsafe-html-text",
			text: "<img src=x onerror=alert(1)>",
		},
		{
			anchor: DOCS_SOURCE_SITE_FIXTURE.attendance.anchors.courseMap,
			kind: "heading",
			level: 2,
			rootUnitId: DOCS_SOURCE_SITE_FIXTURE.attendance.rootUnitIds.courseMap,
			text: "六、课程地图",
		},
	];
}

function standardElements(input: {
	docId: string;
	includeTable: boolean;
	title: string;
	versionId: string;
}): unknown[] {
	return [
		{
			kind: "paragraph",
			rootUnitId: "preamble",
			text: `${input.title}的公开测试正文，用于验证目录、搜索和阅读布局。`,
		},
		{
			anchor: "overview",
			kind: "heading",
			level: 2,
			rootUnitId: "overview-heading",
			text: "基本说明",
		},
		{
			kind: "paragraph",
			rootUnitId: "overview",
			text: "本节包含足够长的中文说明，用于验证窄屏换行、目录定位和搜索摘要。",
		},
		...(input.includeTable
			? [
					{
						kind: "table",
						rootUnitId: "table",
						rows: [
							[
								{ header: true, text: "课程类别" },
								{ header: true, text: "最低学分" },
							],
							[
								{ header: false, text: "通识核心课程" },
								{ header: false, text: "12" },
							],
						],
					},
				]
			: []),
		{
			anchor: "details",
			kind: "heading",
			level: 2,
			rootUnitId: "details-heading",
			text: "办理与适用范围",
		},
		{
			kind: "paragraph",
			rootUnitId: "details",
			text: "详细要求以当前公开版本为准。",
		},
	];
}

function objectRef(key: string, bytes: Uint8Array): ObjectRef {
	return {
		byteSize: bytes.byteLength,
		key,
		sha256: sha256(bytes),
	};
}

function canonicalJsonBytes(value: unknown): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(sortJson(value), undefined, 2)}\n`);
}

function sha256(value: Uint8Array): `sha256:${string}` {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortJson);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, sortJson(child)]),
		);
	}
	return value;
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
