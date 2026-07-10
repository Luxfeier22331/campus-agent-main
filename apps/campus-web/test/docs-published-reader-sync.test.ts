import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	checkCampusPublishedReaderInputs,
	parsePublishedReaderSyncArgs,
	resolvePublishedReaderObjectStoreBucket,
	resolvePublishedReaderObjectStoreConfig,
	resolvePublishedReaderObjectStoreCredentials,
	syncCampusPublishedReaderAssets,
	syncCampusPublishedReaderDocs,
} from "../src/docs-reader-build/sync-campus-published-reader.ts";
import {
	cleanupPublishedReaderFixture,
	createPublishedReaderFixture,
} from "./helpers/published-reader-fixture";

afterEach(cleanupPublishedReaderFixture);

describe("campus-web published reader sync", () => {
	it("uses the standard derived object store bucket env name", () => {
		expect(
			resolvePublishedReaderObjectStoreBucket({
				OBJECT_STORE_BUCKET_DERIVED: "campus-agent-derived-local",
			}),
		).toBe("campus-agent-derived-local");
	});

	it("requires an explicit derived object store bucket for published reader sync", () => {
		expect(() => resolvePublishedReaderObjectStoreBucket({})).toThrow(
			"OBJECT_STORE_BUCKET_DERIVED is required for campus docs published reader sync",
		);
	});

	it("resolves object store config with derived credentials preferred over shared credentials", () => {
		expect(
			resolvePublishedReaderObjectStoreConfig({
				OBJECT_STORE_ACCESS_KEY: "shared-access",
				OBJECT_STORE_BUCKET_DERIVED: "campus-agent-derived",
				OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-access",
				OBJECT_STORE_DERIVED_SECRET_KEY: "derived-secret",
				OBJECT_STORE_ENDPOINT: "http://localhost:9000",
				OBJECT_STORE_SECRET_KEY: "shared-secret",
			}),
		).toMatchObject({
			accessKeyId: "derived-access",
			bucket: "campus-agent-derived",
			credentialMode: "derived",
			endpoint: "http://localhost:9000",
			region: "us-east-1",
			secretAccessKey: "derived-secret",
		});
		expect(
			resolvePublishedReaderObjectStoreConfig({
				OBJECT_STORE_BUCKET_DERIVED: "campus-agent-derived",
				OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-access",
				OBJECT_STORE_DERIVED_SECRET_KEY: "derived-secret",
				OBJECT_STORE_ENDPOINT: "http://localhost:9000",
				OBJECT_STORE_REGION: "auto",
			}),
		).toMatchObject({
			accessKeyId: "derived-access",
			bucket: "campus-agent-derived",
			credentialMode: "derived",
			endpoint: "http://localhost:9000",
			region: "auto",
			secretAccessKey: "derived-secret",
		});
	});

	it("uses derived bucket credentials for published reader object store access", () => {
		expect(
			resolvePublishedReaderObjectStoreCredentials({
				OBJECT_STORE_ACCESS_KEY: "shared-access",
				OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-access",
				OBJECT_STORE_DERIVED_SECRET_KEY: "derived-secret",
				OBJECT_STORE_SECRET_KEY: "shared-secret",
			}),
		).toEqual({
			accessKeyId: "derived-access",
			credentialMode: "derived",
			secretAccessKey: "derived-secret",
		});
	});

	it("fails closed when object store credentials are incomplete", () => {
		expect(() =>
			resolvePublishedReaderObjectStoreConfig({
				OBJECT_STORE_BUCKET_DERIVED: "campus-agent-derived",
				OBJECT_STORE_ENDPOINT: "http://localhost:9000",
			}),
		).toThrow(
			"missing object-store credentials: provide OBJECT_STORE_ACCESS_KEY/OBJECT_STORE_SECRET_KEY or OBJECT_STORE_DERIVED_ACCESS_KEY/OBJECT_STORE_DERIVED_SECRET_KEY",
		);
	});

	it("resolves docs sync manifest selection from CLI args only", () => {
		expect(
			parsePublishedReaderSyncArgs([
				"all",
				"--manifest-path",
				"../../var/docs-reader-sync-manifest.json",
			]),
		).toEqual({
			command: "all",
			manifestFilePath: "../../var/docs-reader-sync-manifest.json",
			manifestObjectKey: undefined,
		});
		expect(
			parsePublishedReaderSyncArgs(["docs", "--manifest-key", "published/docs/manifest.json"]),
		).toEqual({
			command: "docs",
			manifestFilePath: undefined,
			manifestObjectKey: "published/docs/manifest.json",
		});
		expect(
			parsePublishedReaderSyncArgs(["check", "--manifest-path", "../../var/public-docs.json"]),
		).toEqual({
			command: "check",
			manifestFilePath: "../../var/public-docs.json",
			manifestObjectKey: undefined,
		});
	});

	it("rejects ambiguous or env-owned docs sync manifest selection", () => {
		expect(() =>
			parsePublishedReaderSyncArgs([
				"docs",
				"--manifest-path",
				"manifest.json",
				"--manifest-key",
				"k",
			]),
		).toThrow("expected exactly one of --manifest-path or --manifest-key");
		expect(() => parsePublishedReaderSyncArgs(["docs"])).toThrow(
			"expected exactly one of --manifest-path or --manifest-key",
		);
		expect(() =>
			parsePublishedReaderSyncArgs(["docs", "--manifest-path", "manifest.json", "--extra"]),
		).toThrow("unknown docs sync argument");
		expect(() => parsePublishedReaderSyncArgs(["docs", "--manifest-path"])).toThrow(
			"--manifest-path requires a value",
		);
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
		const collectionMeta = readFileSync(
			join(docsRoot, "docs/regulations/student_rules/_meta.json"),
			"utf8",
		);
		const corpusMeta = readFileSync(join(docsRoot, "docs/regulations/_meta.json"), "utf8");
		const versionMdx = readFileSync(
			join(docsRoot, "docs/regulations/student_rules/student-attendance/v/2026-current.mdx"),
			"utf8",
		);
		expect(currentMdx).toContain('title: "中央民族大学学生考勤管理规定"');
		expect(currentMdx).toContain('docsSearchVisibility: "public_current"');
		expect(currentMdx).not.toContain("data-pagefind-body");
		expect(currentMdx).not.toContain("docs-pagefind-page-meta");
		expect(currentMdx).toContain('data-root-unit-id="attendance-root"');
		expect(currentMdx).toContain('data-root-unit-id="regular-enumeration"');
		expect(currentMdx).toContain('<span id="general"></span>');
		expect(currentMdx).toContain("学生应按时参加教学活动。");
		expect(currentMdx).toContain("一、这是一条普通正文，不应自动升级为标题。");
		expect(currentMdx).not.toContain("## 一、这是一条普通正文，不应自动升级为标题。");
		expect(currentMdx).toContain('<div className="docs-table-scroll"');
		expect(currentMdx).toContain('<table><tbody><tr><td>{"活动名称"}</td><td>{"学分"}</td></tr>');
		expect(currentMdx).not.toContain("<table><tr>");
		expect(currentMdx).toContain('<td>{"*战场医疗救护"}</td>');
		expect(currentMdx).toContain('<td rowSpan="2">{"0.5"}</td>');
		expect(currentMdx).not.toContain("&lt;table&gt;&lt;tr&gt;&lt;td&gt;活动名称");
		expect(currentMdx).toContain("&lt;img src=x onerror=alert(1)&gt;");
		expect(currentMdx).toContain("data-docs-versions=");
		expect(currentMdx).toContain("&quot;versionSlug&quot;:&quot;2025-history&quot;");
		expect(currentMdx).toContain('data-docs-route-slug="student-attendance"');
		expect(currentMdx).not.toContain("doc_id");
		expect(currentMdx).not.toContain("version_id");
		expect(currentMdx).not.toContain("## 文档正文");
		expect(currentMdx).not.toContain("\n中央民族大学学生考勤管理规定\n");
		expect(currentMdx).toContain("## 六、课程地图");
		expect(currentMdx).not.toContain(">六、课程地图</div>");
		expect(currentMdx).toContain('className="docs-course-map-figure"');
		expect(currentMdx).toContain(
			'src="/_docs/regulations/student_rules/student-attendance/2026-current/course-maps/page-0001-map-01.png"',
		);
		expect(currentMdx).toContain('alt="学生考勤课程地图"');
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
		const docsIndex = readFileSync(join(docsRoot, "docs/index.md"), "utf8");
		const corpusIndex = readFileSync(join(docsRoot, "docs/regulations/index.md"), "utf8");
		const collectionIndex = readFileSync(
			join(docsRoot, "docs/regulations/student_rules/index.md"),
			"utf8",
		);
		expect(docsIndex).toContain("# 文档");
		expect(docsIndex).toContain("## 文档集合\n\n<nav");
		expect(docsIndex).not.toContain(
			'<nav className="docs-category-links" aria-label="文档目录">\n\n## 文档集合',
		);
		expect(docsIndex).toContain('href="/docs/regulations/"');
		expect(corpusIndex).toContain("# 规章制度");
		expect(corpusIndex).toContain("## 集合\n\n<nav");
		expect(corpusIndex).not.toContain(
			'<nav className="docs-category-links" aria-label="文档集合目录">\n\n## 集合',
		);
		expect(corpusIndex).toContain('href="/docs/regulations/student_rules/"');
		expect(collectionIndex).toContain("# 学生手册");
		expect(collectionIndex).toContain("## 文档\n\n<nav");
		expect(collectionIndex).not.toContain(
			'<nav className="docs-category-links" aria-label="文档列表">\n\n## 文档',
		);
		expect(collectionIndex).toContain('href="/docs/regulations/student_rules/student-attendance"');
		expect(corpusMeta).toContain('"name": "index"');
		expect(collectionMeta).toContain('"label": "学生考勤管理规定"');
		expect(collectionMeta).not.toContain('"label": "中央民族大学学生考勤管理规定"');
		expect(collectionMeta).toContain('"name": "index"');
	});

	it("materializes non-ASCII document slugs under route-safe reader URLs", async () => {
		const { client, manifestPath, root } = createPublishedReaderFixture({
			publicDocumentSlug: "中央民族大学学生考勤管理规定",
		});
		const docsRoot = join(root, "docs");

		await syncCampusPublishedReaderDocs({
			client,
			docsRoot,
			manifestFilePath: manifestPath,
		});

		const collectionMeta = readFileSync(
			join(docsRoot, "docs/regulations/student_rules/_meta.json"),
			"utf8",
		);
		const routeSlug = collectionMeta.match(/"name": "(doc-[a-f0-9]{12})"/u)?.[1] ?? "";
		const currentMdx = readFileSync(
			join(docsRoot, `docs/regulations/student_rules/${routeSlug}.mdx`),
			"utf8",
		);

		expect(routeSlug).toMatch(/^doc-[a-f0-9]{12}$/u);
		expect(currentMdx).toContain('data-docs-document-slug="中央民族大学学生考勤管理规定"');
		expect(currentMdx).toContain(`data-docs-route-slug="${routeSlug}"`);
		expect(collectionMeta).toContain(`"name": "${routeSlug}"`);
		expect(collectionMeta).not.toContain('"name": "中央民族大学学生考勤管理规定"');
		expect(existsSync(join(docsRoot, "docs/regulations/student_rules/index.md"))).toBe(true);
	});

	it("escapes generated reader attribute values without changing text content", async () => {
		const { client, manifestPath, root } = createPublishedReaderFixture({
			publicReaderAnchor: 'general"reader',
			publicReaderRootUnitId: 'attendance"root',
		});
		const docsRoot = join(root, "docs");

		await syncCampusPublishedReaderDocs({
			client,
			docsRoot,
			manifestFilePath: manifestPath,
		});

		const currentMdx = readFileSync(
			join(docsRoot, "docs/regulations/student_rules/student-attendance.mdx"),
			"utf8",
		);

		expect(currentMdx).toContain('<span id="general&quot;reader"></span>');
		expect(currentMdx).toContain('data-root-unit-id="attendance&quot;root"');
		expect(currentMdx).toContain("学生应按时参加教学活动。");
		expect(currentMdx).not.toContain('<span id="general"reader"></span>');
		expect(currentMdx).not.toContain('data-root-unit-id="attendance"root"');
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

	it("checks published reader inputs without writing generated docs or static assets", async () => {
		const { client, manifestPath, root } = createPublishedReaderFixture();
		const docsRoot = join(root, "docs");
		const targetRoot = join(root, "public");

		const result = await checkCampusPublishedReaderInputs({
			client,
			docsRoot,
			manifestFilePath: manifestPath,
			targetRoot,
		});

		expect(result).toMatchObject({
			checkedDocumentCount: 3,
			checkedObjectCount: 16,
			checkedProtectedSearchIndexCount: 1,
		});
		expect(() =>
			readFileSync(join(docsRoot, "docs/regulations/student_rules/student-attendance.mdx")),
		).toThrow();
		expect(() =>
			readFileSync(
				join(
					targetRoot,
					"_docs/regulations/student_rules/student-attendance/2026-current/reader.json",
				),
			),
		).toThrow();
	});

	it("fails closed when check mode finds a missing reader source object", async () => {
		const { client, manifestPath } = createPublishedReaderFixture({
			missingObjects: ["reader/public.json"],
		});

		await expect(
			checkCampusPublishedReaderInputs({
				client,
				manifestFilePath: manifestPath,
			}),
		).rejects.toThrow("missing reader asset source object: reader/public.json");
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

	it("fails closed when current public reader display titles collide", async () => {
		const { client, manifestPath, root } = createPublishedReaderFixture();
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			entries: Record<string, unknown>[];
		};
		manifest.entries.push({
			...manifest.entries[0],
			docId: "doc_public_duplicate",
			documentSlug: "student-attendance-copy",
			versionId: "version_public_duplicate",
		});
		writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

		await expect(
			syncCampusPublishedReaderDocs({
				client,
				docsRoot: join(root, "docs"),
				manifestFilePath: manifestPath,
			}),
		).rejects.toThrow("duplicate current public reader display title");
	});

	it("fails closed when protected search units reference missing reader anchors", async () => {
		const { client, manifestPath } = createPublishedReaderFixture({
			protectedSearchAnchor: "missing-anchor",
		});

		await expect(
			checkCampusPublishedReaderInputs({
				client,
				manifestFilePath: manifestPath,
			}),
		).rejects.toThrow("protected search unit anchor does not exist in reader asset");
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
