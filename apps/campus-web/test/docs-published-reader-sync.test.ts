import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	resolvePublishedReaderObjectStoreBucket,
	syncCampusPublishedReaderAssets,
	syncCampusPublishedReaderDocs,
} from "../scripts/sync-campus-published-reader.mjs";

interface ObjectStoreClient {
	readOptionalBytesObject(input: { key: string }): Promise<Uint8Array | undefined>;
	readTextObject(input: { key: string }): Promise<string>;
}

let tempDir: string | null = null;

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { force: true, recursive: true });
		tempDir = null;
	}
});

describe("campus-web published reader sync", () => {
	it("uses the standard derived object store bucket env name", () => {
		expect(
			resolvePublishedReaderObjectStoreBucket({
				OBJECT_STORE_BUCKET_DERIVED: "campus-rag-derived-local",
			}),
		).toBe("campus-rag-derived-local");
	});

	it("generates Rspress MDX reader pages with stable rootUnitId anchors", async () => {
		const { client, manifestPath, root } = createPublishedReaderFixture();
		const docsRoot = join(root, "docs");

		const result = await syncCampusPublishedReaderDocs({
			client,
			docsRoot,
			manifestFilePath: manifestPath,
		});

		expect(result).toMatchObject({
			generatedGatedDocumentCount: 1,
			generatedPublicDocumentCount: 2,
			generatedDocumentCount: 3,
		});
		const currentMdx = readFileSync(
			join(docsRoot, "docs/regulations/student_rules/student-attendance.mdx"),
			"utf8",
		);
		const gatedMdx = readFileSync(
			join(docsRoot, "docs/regulations/student_rules/restricted-policy.mdx"),
			"utf8",
		);
		const gatedVersionMdx = readFileSync(
			join(docsRoot, "docs/regulations/student_rules/restricted-policy/v/2026-current.mdx"),
			"utf8",
		);
		const collectionIndex = readFileSync(
			join(docsRoot, "docs/regulations/student_rules/index.md"),
			"utf8",
		);
		const versionMdx = readFileSync(
			join(docsRoot, "docs/regulations/student_rules/student-attendance/v/2026-current.mdx"),
			"utf8",
		);
		expect(currentMdx).toContain('docsSearchVisibility: "public_current"');
		expect(currentMdx).not.toContain("data-pagefind-body");
		expect(currentMdx).not.toContain("docs-pagefind-page-meta");
		expect(currentMdx).toContain('data-root-unit-id="attendance-root"');
		expect(currentMdx).toContain('<span id="general"></span>');
		expect(currentMdx).toContain("学生应按时参加教学活动。");
		expect(currentMdx).toContain("data-docs-versions=");
		expect(currentMdx).toContain("&quot;versionSlug&quot;:&quot;2025-history&quot;");
		expect(currentMdx).not.toContain("doc_id");
		expect(currentMdx).not.toContain("version_id");
		expect(versionMdx).toContain('data-docs-version-slug="2026-current"');
		expect(versionMdx).toContain('docsSearchVisibility: "noindex"');
		expect(gatedMdx).toContain("GatedReaderBootstrap");
		expect(gatedMdx).toContain('docsSearchVisibility: "gated_bootstrap"');
		expect(gatedMdx).toContain(
			'import GatedReaderBootstrap from "@/components/docs/gated-reader-bootstrap";',
		);
		expect(gatedVersionMdx).toContain(
			'import GatedReaderBootstrap from "@/components/docs/gated-reader-bootstrap";',
		);
		expect(gatedVersionMdx).toContain('docsSearchVisibility: "gated_bootstrap"');
		expect(collectionIndex).toContain("学生考勤管理规定");
		expect(collectionIndex).toContain('docsSearchVisibility: "noindex"');
		expect(collectionIndex).not.toContain("restricted-policy");
		expect(collectionIndex).not.toContain("受限制度");
	});

	it("copies published reader assets into campus-web static delivery roots", async () => {
		const { client, manifestPath, root } = createPublishedReaderFixture();
		const targetRoot = join(root, "public");

		const result = await syncCampusPublishedReaderAssets({
			client,
			manifestFilePath: manifestPath,
			targetRoot,
		});

		expect(result).toMatchObject({
			copiedDocumentCount: 3,
			copiedGatedDocumentCount: 1,
			copiedPublicDocumentCount: 2,
		});
		expect(
			readFileSync(
				join(
					targetRoot,
					"_docs/regulations/student_rules/student-attendance/2026-current/reader.json",
				),
				"utf8",
			),
		).toContain("attendance-root");
		expect(
			readFileSync(
				join(
					targetRoot,
					"_gated-docs/regulations/student_rules/restricted-policy/2026-current/reader.json",
				),
				"utf8",
			),
		).toContain("restricted-root");
		const protectedSearchIndex = JSON.parse(
			readFileSync(
				join(
					targetRoot,
					"_gated-docs-search/regulations/student_rules/restricted-policy/2026-current/index.json",
				),
				"utf8",
			),
		) as {
			schemaVersion: string;
			visibilityMode: string;
			entries: Array<{
				anchor: string;
				canonicalUrl: string;
				collectionLabel: string;
				documentSlug: string;
				highlightRootUnitIds: string[];
				searchText: string;
				sectionTitle: string;
				versionSlug: string;
			}>;
		};
		expect(protectedSearchIndex.schemaVersion).toBe("campus_docs_protected_search_index_v1");
		expect(protectedSearchIndex.visibilityMode).toBe("principal_protected_static");
		expect(protectedSearchIndex.entries).toEqual([
			{
				anchor: "restricted",
				canonicalUrl: "/docs/regulations/student_rules/restricted-policy",
				collection: "student_rules",
				collectionLabel: "学生手册",
				corpus: "regulations",
				documentSlug: "restricted-policy",
				documentTitle: "受限制度",
				highlightRootUnitIds: ["restricted-root"],
				searchText: "受限制度 受限章节 这是一条受限正文。",
				searchUnitId: "search_gated_current_restricted",
				sectionTitle: "受限章节",
				snippet: "这是一条受限正文。",
				versionSlug: "2026-current",
			},
		]);
	});

	it("fails closed when the published reader manifest omits protected search units", async () => {
		const { client, manifestPath, root } = createPublishedReaderFixture({
			includeSearchUnits: false,
		});

		await expect(
			syncCampusPublishedReaderAssets({
				client,
				manifestFilePath: manifestPath,
				targetRoot: join(root, "public"),
			}),
		).rejects.toThrow("campus docs reader release manifest must contain searchUnits[]");
	});

	it("fails closed when the reader release manifest has an unsupported surface", async () => {
		const { client, manifestPath, root } = createPublishedReaderFixture({
			surface: "legacy_public_docs",
		});

		await expect(
			syncCampusPublishedReaderAssets({
				client,
				manifestFilePath: manifestPath,
				targetRoot: join(root, "public"),
			}),
		).rejects.toThrow("unsupported docs reader release manifest surface");
	});
});

function createPublishedReaderFixture(
	input: { includeSearchUnits?: boolean; surface?: string } = {},
): {
	client: ObjectStoreClient;
	manifestPath: string;
	root: string;
} {
	tempDir = mkdtempSync(join(tmpdir(), "campus-docs-sync-"));
	const root = tempDir;
	const publicReader = JSON.stringify({
		document: { title: "学生考勤管理规定" },
		sections: [
			{
				anchor: "general",
				blocks: [
					{
						kind: "paragraph",
						rootUnitId: "attendance-root",
						text: "学生应按时参加教学活动。",
					},
				],
				title: "总则",
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
	const gatedOutline = "{}";
	const gatedMeta = JSON.stringify({ sourceLabel: "受限制度" });
	const objects = new Map<string, string>([
		["reader/public.json", publicReader],
		["reader/public-history.json", publicReader],
		["outline/public.json", publicOutline],
		["outline/public-history.json", publicOutline],
		["meta/public.json", publicMeta],
		["meta/public-history.json", publicMeta],
		[
			"manifest/public.json",
			buildAssetManifest({ meta: publicMeta, outline: publicOutline, reader: publicReader }),
		],
		[
			"manifest/public-history.json",
			buildAssetManifest({ meta: publicMeta, outline: publicOutline, reader: publicReader }),
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
			anchor: "general",
			canonicalUrl: "/docs/regulations/student_rules/student-attendance#general",
			collection: "student_rules",
			corpus: "regulations",
			docId: "doc_public",
			documentSlug: "student-attendance",
			documentTitle: "学生考勤管理规定",
			highlightRootUnitIds: ["attendance-root"],
			searchUnitId: "search_public_current_general",
			snippet: "学生应按时参加教学活动。",
			title: "总则",
			versionId: "version_public",
			versionSlug: "2026-current",
		},
		{
			anchor: "restricted",
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
				documentSlug: "student-attendance",
				isCurrent: true,
				sourceObjects: {
					"asset-manifest": "manifest/public.json",
					meta: "meta/public.json",
					outline: "outline/public.json",
					reader: "reader/public.json",
				},
				targetObjects: {
					"asset-manifest":
						"_docs/regulations/student_rules/student-attendance/2026-current/asset-manifest.json",
					meta: "_docs/regulations/student_rules/student-attendance/2026-current/meta.json",
					outline: "_docs/regulations/student_rules/student-attendance/2026-current/outline.json",
					reader: "_docs/regulations/student_rules/student-attendance/2026-current/reader.json",
				},
				title: "学生考勤管理规定",
				versionId: "version_public",
				versionLabel: "现行版",
				versionSlug: "2026-current",
			},
			{
				collection: "student_rules",
				corpus: "regulations",
				deliveryMode: "public_static_asset",
				docId: "doc_public",
				documentSlug: "student-attendance",
				isCurrent: false,
				sourceObjects: {
					"asset-manifest": "manifest/public-history.json",
					meta: "meta/public-history.json",
					outline: "outline/public-history.json",
					reader: "reader/public-history.json",
				},
				targetObjects: {
					"asset-manifest":
						"_docs/regulations/student_rules/student-attendance/2025-history/asset-manifest.json",
					meta: "_docs/regulations/student_rules/student-attendance/2025-history/meta.json",
					outline: "_docs/regulations/student_rules/student-attendance/2025-history/outline.json",
					reader: "_docs/regulations/student_rules/student-attendance/2025-history/reader.json",
				},
				title: "学生考勤管理规定",
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
			{
				collection: "student_rules",
				corpus: "regulations",
				deliveryMode: "withheld",
				docId: "doc_withheld",
				documentSlug: "withheld-policy",
				isCurrent: true,
				sourceObjects: {
					"asset-manifest": "manifest/gated.json",
					meta: "meta/gated.json",
					outline: "outline/gated.json",
					reader: "reader/gated.json",
				},
				targetObjects: {
					"asset-manifest":
						"_gated-docs/regulations/student_rules/withheld-policy/2026-current/asset-manifest.json",
					meta: "_gated-docs/regulations/student_rules/withheld-policy/2026-current/meta.json",
					outline:
						"_gated-docs/regulations/student_rules/withheld-policy/2026-current/outline.json",
					reader: "_gated-docs/regulations/student_rules/withheld-policy/2026-current/reader.json",
				},
				title: "不发布制度",
				versionId: "version_withheld",
				versionLabel: "现行版",
				versionSlug: "2026-current",
			},
		],
		...(input.includeSearchUnits === false ? {} : { searchUnits }),
		surface: input.surface ?? "public_docs",
	};
	const manifestPath = join(root, "manifest.json");
	writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
	return {
		client: {
			async readOptionalBytesObject(input) {
				const value = objects.get(input.key);
				return value ? new TextEncoder().encode(value) : undefined;
			},
			async readTextObject(input) {
				const value = objects.get(input.key);
				if (!value) {
					throw new Error(`missing object: ${input.key}`);
				}
				return value;
			},
		},
		manifestPath,
		root,
	};
}

function buildAssetManifest(input: { meta: string; outline: string; reader: string }): string {
	return JSON.stringify({
		files: {
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

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
