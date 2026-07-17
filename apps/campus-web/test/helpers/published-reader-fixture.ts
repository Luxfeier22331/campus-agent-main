import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ObjectStoreClient {
	readOptionalBytesObject(input: { key: string }): Promise<Uint8Array | undefined>;
	readTextObject(input: { key: string }): Promise<string>;
}

export interface PublishedReaderFixtureInput {
	includeSearchUnits?: boolean;
	missingObjects?: string[];
	publicReaderAnchor?: string;
	protectedSearchAnchor?: string;
	publicReaderRootUnitId?: string;
	publicSectionTitle?: string;
	publicDocumentSlug?: string;
	surface?: string;
}

export interface PublishedReaderFixture {
	client: ObjectStoreClient;
	manifestPath: string;
	root: string;
}

let tempDir: string | null = null;

type FixtureObject = string | Uint8Array;

const COURSE_MAP_IMAGE = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAHklEQVR4nGN48OmjTnw+8SQDSaoffPrIMGoDLWwAAOICDTjkUnTKAAAAAElFTkSuQmCC",
	"base64",
);

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
	const publicDocumentSlug = input.publicDocumentSlug ?? "student-attendance";
	const publicReaderAnchor = input.publicReaderAnchor ?? "general";
	const publicReaderRootUnitId = input.publicReaderRootUnitId ?? "attendance-root";
	const publicReader = JSON.stringify({
		document: { title: "中央民族大学学生考勤管理规定" },
		supplements: [{ kind: "course_maps", path: "course-maps.json" }],
		sections: [
			{
				anchor: publicReaderAnchor,
				blocks: [
					{
						kind: "paragraph",
						rootUnitId: publicReaderRootUnitId,
						text: "学生应按时参加教学活动。",
					},
					{
						kind: "paragraph",
						rootUnitId: "regular-enumeration",
						text: "一、这是一条普通正文，不应自动升级为标题。",
					},
					{
						kind: "paragraph",
						rootUnitId: "activity-credit-table",
						text: '<table><tr><td>活动名称</td><td>学分</td></tr><tr><td>校级社会实践</td><td>1</td></tr><tr><td>*战场医疗救护</td><td rowspan="2">0.5</td></tr><tr><td>志愿服务</td></tr></table>',
					},
					{
						kind: "paragraph",
						rootUnitId: "unsafe-html-text",
						text: "<img src=x onerror=alert(1)>",
					},
					{
						kind: "heading",
						rootUnitId: "course-map-heading",
						text: "六、课程地图",
					},
				],
				title: input.publicSectionTitle ?? "文档正文",
			},
		],
	});
	const gatedReader = JSON.stringify({
		document: { title: "受限制度" },
		sections: [
			{
				anchor: "restricted",
				blocks: [
					{
						kind: "paragraph",
						rootUnitId: "restricted-root",
						text: "这是一条受限正文。",
					},
				],
				title: "受限章节",
			},
		],
	});
	const publicOutline = "{}";
	const publicMeta = JSON.stringify({ sourceLabel: "学生手册" });
	const publicCourseMaps = JSON.stringify({
		blocks: [
			{
				blockId: "page-0001-map-01",
				imagePath: "course-maps/page-0001-map-01.png",
				parentHeadingHint: "六、课程地图",
				title: "学生考勤课程地图",
			},
		],
		schemaVersion: "curriculum_course_maps_reader_v1",
	});
	const gatedOutline = "{}";
	const gatedMeta = JSON.stringify({ sourceLabel: "受限制度" });
	const objects = new Map<string, FixtureObject>([
		["reader/public.json", publicReader],
		["reader/public-history.json", publicReader],
		["outline/public.json", publicOutline],
		["outline/public-history.json", publicOutline],
		["meta/public.json", publicMeta],
		["meta/public-history.json", publicMeta],
		["supplements/public-course-maps.json", publicCourseMaps],
		["supplements/public-course-map-image.png", COURSE_MAP_IMAGE],
		[
			"manifest/public.json",
			buildAssetManifest({
				courseMapImage: COURSE_MAP_IMAGE,
				courseMaps: publicCourseMaps,
				meta: publicMeta,
				outline: publicOutline,
				reader: publicReader,
			}),
		],
		[
			"manifest/public-history.json",
			buildAssetManifest({
				courseMapImage: COURSE_MAP_IMAGE,
				courseMaps: publicCourseMaps,
				meta: publicMeta,
				outline: publicOutline,
				reader: publicReader,
			}),
		],
		["reader/gated.json", gatedReader],
		["outline/gated.json", gatedOutline],
		["meta/gated.json", gatedMeta],
		[
			"manifest/gated.json",
			buildAssetManifest({ meta: gatedMeta, outline: gatedOutline, reader: gatedReader }),
		],
	]);
	const searchUnits = [
		{
			anchor: publicReaderAnchor,
			canonicalUrl: `/docs/regulations/student_rules/${publicDocumentSlug}#${encodeURIComponent(publicReaderAnchor)}`,
			collection: "student_rules",
			corpus: "regulations",
			docId: "doc_public",
			documentSlug: publicDocumentSlug,
			documentTitle: "中央民族大学学生考勤管理规定",
			highlightRootUnitIds: [publicReaderRootUnitId],
			searchUnitId: "search_public_current_general",
			snippet: "学生应按时参加教学活动。",
			title: "总则",
			versionId: "version_public",
			versionSlug: "2026-current",
		},
		{
			anchor: input.protectedSearchAnchor ?? "restricted",
			canonicalUrl: "/docs/regulations/student_rules/restricted-policy#restricted",
			collection: "student_rules",
			corpus: "regulations",
			docId: "doc_gated",
			documentSlug: "restricted-policy",
			documentTitle: "受限制度",
			highlightRootUnitIds: ["restricted-root"],
			searchUnitId: "search_gated_current_restricted",
			snippet: "这是一条受限正文。",
			title: "受限章节",
			versionId: "version_gated",
			versionSlug: "2026-current",
		},
	];
	const manifest = {
		entries: [
			{
				collection: "student_rules",
				corpus: "regulations",
				deliveryMode: "public_static_asset",
				docId: "doc_public",
				documentSlug: publicDocumentSlug,
				isCurrent: true,
				sourceObjects: {
					"asset-manifest": "manifest/public.json",
					meta: "meta/public.json",
					outline: "outline/public.json",
					reader: "reader/public.json",
					"supplement.course-maps.json": "supplements/public-course-maps.json",
					"supplement.course-maps/page-0001-map-01.png": "supplements/public-course-map-image.png",
				},
				targetObjects: {
					"asset-manifest":
						"_docs/regulations/student_rules/student-attendance/2026-current/asset-manifest.json",
					"course-maps.json":
						"_docs/regulations/student_rules/student-attendance/2026-current/course-maps.json",
					"course-maps/page-0001-map-01.png":
						"_docs/regulations/student_rules/student-attendance/2026-current/course-maps/page-0001-map-01.png",
					meta: "_docs/regulations/student_rules/student-attendance/2026-current/meta.json",
					outline: "_docs/regulations/student_rules/student-attendance/2026-current/outline.json",
					reader: "_docs/regulations/student_rules/student-attendance/2026-current/reader.json",
				},
				title: "中央民族大学学生考勤管理规定",
				versionId: "version_public",
				versionLabel: "现行版",
				versionSlug: "2026-current",
			},
			{
				collection: "student_rules",
				corpus: "regulations",
				deliveryMode: "public_static_asset",
				docId: "doc_public",
				documentSlug: publicDocumentSlug,
				isCurrent: false,
				sourceObjects: {
					"asset-manifest": "manifest/public-history.json",
					meta: "meta/public-history.json",
					outline: "outline/public-history.json",
					reader: "reader/public-history.json",
					"supplement.course-maps.json": "supplements/public-course-maps.json",
					"supplement.course-maps/page-0001-map-01.png": "supplements/public-course-map-image.png",
				},
				targetObjects: {
					"asset-manifest":
						"_docs/regulations/student_rules/student-attendance/2025-history/asset-manifest.json",
					"course-maps.json":
						"_docs/regulations/student_rules/student-attendance/2025-history/course-maps.json",
					"course-maps/page-0001-map-01.png":
						"_docs/regulations/student_rules/student-attendance/2025-history/course-maps/page-0001-map-01.png",
					meta: "_docs/regulations/student_rules/student-attendance/2025-history/meta.json",
					outline: "_docs/regulations/student_rules/student-attendance/2025-history/outline.json",
					reader: "_docs/regulations/student_rules/student-attendance/2025-history/reader.json",
				},
				title: "中央民族大学学生考勤管理规定",
				versionId: "version_public_history",
				versionLabel: "2025 版",
				versionSlug: "2025-history",
			},
			{
				collection: "student_rules",
				corpus: "regulations",
				deliveryMode: "gated_asset",
				docId: "doc_gated",
				documentSlug: "restricted-policy",
				isCurrent: true,
				sourceObjects: {
					"asset-manifest": "manifest/gated.json",
					meta: "meta/gated.json",
					outline: "outline/gated.json",
					reader: "reader/gated.json",
				},
				targetObjects: {
					"asset-manifest":
						"_docs/regulations/student_rules/restricted-policy/2026-current/asset-manifest.json",
					meta: "_docs/regulations/student_rules/restricted-policy/2026-current/meta.json",
					outline: "_docs/regulations/student_rules/restricted-policy/2026-current/outline.json",
					reader: "_docs/regulations/student_rules/restricted-policy/2026-current/reader.json",
				},
				title: "受限制度",
				versionId: "version_gated",
				versionLabel: "现行版",
				versionSlug: "2026-current",
			},
		],
		projection: {
			byteSize: 1,
			key: "docs-reader/projections/sha256/fixture.json",
			sha256: `sha256:${"a".repeat(64)}`,
		},
		...(input.includeSearchUnits === false ? {} : { searchUnits }),
		schemaVersion: "campus_docs_release_manifest.v1",
		sourceReleaseRefs: [
			{
				byteSize: 1,
				key: "docs-reader/source-releases/fixture.json",
				sha256: `sha256:${"b".repeat(64)}`,
			},
		],
		surface: input.surface ?? "campus_docs",
	};
	const manifestPath = join(root, "manifest.json");
	writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
	const missingObjects = new Set(input.missingObjects ?? []);
	return {
		client: {
			async readOptionalBytesObject(input) {
				if (missingObjects.has(input.key)) {
					return;
				}
				const value = objects.get(input.key);
				return value === undefined ? undefined : toBytes(value);
			},
			async readTextObject(input) {
				if (missingObjects.has(input.key)) {
					throw new Error(`missing object: ${input.key}`);
				}
				const value = objects.get(input.key);
				if (value === undefined) {
					throw new Error(`missing object: ${input.key}`);
				}
				if (typeof value !== "string") {
					throw new Error(`object is not text: ${input.key}`);
				}
				return value;
			},
		},
		manifestPath,
		root,
	};
}

function buildAssetManifest(input: {
	courseMapImage?: Uint8Array;
	courseMaps?: string;
	meta: string;
	outline: string;
	reader: string;
}): string {
	return JSON.stringify({
		files: {
			...(input.courseMaps
				? {
						"course-maps.json": {
							sha256: sha256(input.courseMaps),
							sizeBytes: toBytes(input.courseMaps).byteLength,
						},
					}
				: {}),
			...(input.courseMapImage
				? {
						"course-maps/page-0001-map-01.png": {
							sha256: sha256(input.courseMapImage),
							sizeBytes: input.courseMapImage.byteLength,
						},
					}
				: {}),
			"meta.json": {
				sha256: sha256(input.meta),
				sizeBytes: new TextEncoder().encode(input.meta).byteLength,
			},
			"outline.json": {
				sha256: sha256(input.outline),
				sizeBytes: new TextEncoder().encode(input.outline).byteLength,
			},
			"reader.json": {
				sha256: sha256(input.reader),
				sizeBytes: new TextEncoder().encode(input.reader).byteLength,
			},
		},
	});
}

function sha256(value: FixtureObject): string {
	return createHash("sha256").update(value).digest("hex");
}

function toBytes(value: FixtureObject): Uint8Array {
	return typeof value === "string" ? new TextEncoder().encode(value) : value;
}
