import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ReaderObjectStoreClient } from "../../src/docs-reader-build/published-reader-types.ts";
import {
	canonicalJsonBytes,
	DOCS_SOURCE_KEY,
	normalizeSourceManifest,
	sha256,
} from "../../src/docs-reader-build/source-catalog.ts";
import type {
	DocsDocument,
	DocsSourceManifest,
	DocsSourceVersion,
	ObjectRef,
} from "../../src/docs-reader-build/source-types.ts";
import { COURSE_MAP_IMAGE } from "./published-reader-fixture.ts";

export interface DocsSourceFixture {
	client: ReaderObjectStoreClient;
	root: string;
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
		currentVersionSlug: "2026-current",
		documentSlug: "doc-c62077b20430",
		historicalVersionSlug: "2025-history",
		path: "/docs/regulations/student_rules/doc-c62077b20430",
		rootUnitIds: {
			body: "attendance-root",
			courseMap: "course-map-heading",
		},
	},
} as const;

let tempDir: string | null = null;

export function cleanupDocsSourceFixture(): void {
	if (tempDir) {
		rmSync(tempDir, { force: true, recursive: true });
		tempDir = null;
	}
}

export function createDocsSourceSiteFixture(
	input: { missingObjects?: string[] } = {},
): DocsSourceFixture {
	cleanupDocsSourceFixture();
	tempDir = mkdtempSync(join(tmpdir(), "campus-docs-source-"));
	const objects = new Map<string, Uint8Array>();
	const addObject = (key: string, value: unknown, format: "bytes" | "json" = "json") => {
		const bytes = format === "bytes" ? (value as Uint8Array) : canonicalJsonBytes(value);
		objects.set(key, bytes);
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
			const currentVersionId = `${docId}_current`;
			const title = isAttendanceDocument
				? "中央民族大学学生考勤管理规定"
				: `${collection.displayName}示例文档 ${ordinal}`;
			const topicId = topicByCollection.get(collection.collection) ?? null;
			documents.push({
				collection: collection.collection,
				corpus: collection.corpus,
				currentVersionId,
				currentVersionSlug: DOCS_SOURCE_SITE_FIXTURE.attendance.currentVersionSlug,
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
					isCurrent: true,
					label: "现行版",
					sourceLabel: collection.displayName,
					title,
					versionId: currentVersionId,
					versionSlug: DOCS_SOURCE_SITE_FIXTURE.attendance.currentVersionSlug,
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
						isCurrent: false,
						label: "2025 版",
						sourceLabel: collection.displayName,
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
		schemaVersion: "campus_docs_source.v3",
		topics,
		versions,
	});
	const sourceBytes = canonicalJsonBytes(source);
	objects.set(DOCS_SOURCE_KEY, sourceBytes);
	const missingObjects = new Set(input.missingObjects ?? []);
	return {
		client: {
			async readOptionalBytesObject({ key }) {
				if (missingObjects.has(key)) {
					return;
				}
				return objects.get(key);
			},
		},
		root: tempDir,
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
	isCurrent: boolean;
	label: string;
	sourceLabel: string;
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
		effectiveFrom: input.isCurrent ? "2026-01-01" : "2025-01-01",
		isCurrent: input.isCurrent,
		label: input.label,
		reader,
		sourceLabel: input.sourceLabel,
		supplements,
		updatedAt: input.isCurrent ? "2026-07-26T00:00:00.000Z" : "2025-07-26T00:00:00.000Z",
		versionId: input.versionId,
		versionSlug: input.versionSlug,
	};
}

function attendanceElements(input: {
	docId: string;
	includeTable: boolean;
	isCurrent: boolean;
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
			text: input.isCurrent
				? "学生应按时参加教学活动。"
				: "2025 版测试正文：学生应按历史规定参加教学活动。",
		},
		{
			kind: "paragraph",
			rootUnitId: "regular-enumeration",
			text: "一、这是一条普通正文，不应自动升级为标题。",
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
