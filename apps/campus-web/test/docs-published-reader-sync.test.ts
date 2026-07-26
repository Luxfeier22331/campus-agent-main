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
	it("uses the canonical derived object store bucket", () => {
		expect(resolvePublishedReaderObjectStoreBucket()).toBe("campus-agent-derived");
	});

	it("resolves object store config from the derived identity", () => {
		expect(
			resolvePublishedReaderObjectStoreConfig({
				OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-access",
				OBJECT_STORE_DERIVED_SECRET_KEY: "derived-secret",
				OBJECT_STORE_ENDPOINT: "http://localhost:9000",
			}),
		).toMatchObject({
			accessKeyId: "derived-access",
			bucket: "campus-agent-derived",
			credentialMode: "derived",
			endpoint: "http://localhost:9000",
			region: "us-east-1",
			secretAccessKey: "derived-secret",
		});
	});

	it("uses derived bucket credentials for published reader object store access", () => {
		expect(
			resolvePublishedReaderObjectStoreCredentials({
				OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-access",
				OBJECT_STORE_DERIVED_SECRET_KEY: "derived-secret",
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
				OBJECT_STORE_ENDPOINT: "http://localhost:9000",
			}),
		).toThrow("OBJECT_STORE_DERIVED_ACCESS_KEY is required");
	});

	it("resolves docs sync manifest selection from CLI args only", () => {
		expect(
			parsePublishedReaderSyncArgs([
				"all",
				"--manifest-path",
				"../../var/docs-release-manifest.json",
			]),
		).toEqual({
			command: "all",
			manifestFilePath: "../../var/docs-release-manifest.json",
		});
		expect(
			parsePublishedReaderSyncArgs(["check", "--manifest-path", "../../var/public-docs.json"]),
		).toEqual({
			command: "check",
			manifestFilePath: "../../var/public-docs.json",
		});
		expect(() =>
			parsePublishedReaderSyncArgs(["docs", "--manifest-key", "published/docs/manifest.json"]),
		).toThrow("unknown docs sync argument");
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
		).toThrow("unknown docs sync argument");
		expect(() => parsePublishedReaderSyncArgs(["docs"])).toThrow("--manifest-path is required");
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
		expect(currentMdx).toContain('description: "学生应按时参加教学活动。"');
		expect(currentMdx).toContain(
			'head: [["link",{"href":"/docs/regulations/student_rules/student-attendance","rel":"canonical"}]]',
		);
		expect(currentMdx).not.toContain("data-pagefind-body");
		expect(currentMdx).not.toContain("docs-pagefind-page-meta");
		expect(currentMdx).toContain('<ReaderBlock rootUnitId={"attendance-root"}>');
		expect(currentMdx).toContain('<ReaderBlock rootUnitId={"regular-enumeration"}>');
		expect(currentMdx).toContain('<ReaderAnchor id={"general"} />');
		expect(currentMdx).toContain("学生应按时参加教学活动。");
		expect(currentMdx).toContain("一、这是一条普通正文，不应自动升级为标题。");
		expect(currentMdx).not.toContain("## 一、这是一条普通正文，不应自动升级为标题。");
		expect(currentMdx).toContain("<ReaderTable rows={");
		expect(currentMdx).toContain('{"tag":"td","text":"活动名称"}');
		expect(currentMdx).not.toContain("<table><tr>");
		expect(currentMdx).toContain('{"tag":"td","text":"*战场医疗救护"}');
		expect(currentMdx).toContain('{"rowSpan":2,"tag":"td","text":"0.5"}');
		expect(currentMdx).not.toContain("&lt;table&gt;&lt;tr&gt;&lt;td&gt;活动名称");
		expect(currentMdx).toContain("&lt;img src=x onerror=alert(1)&gt;");
		expect(currentMdx).toContain("versions={[");
		expect(currentMdx).toContain('"versionSlug":"2025-history"');
		expect(currentMdx).toContain('routeSlug={"student-attendance"}');
		expect(currentMdx).not.toContain("doc_id");
		expect(currentMdx).not.toContain("version_id");
		expect(currentMdx).not.toContain("## 文档正文");
		expect(currentMdx).not.toContain("\n中央民族大学学生考勤管理规定\n");
		expect(currentMdx).toContain("## 六、课程地图");
		expect(currentMdx).not.toContain(">六、课程地图</div>");
		expect(currentMdx).toContain('className="docs-course-map-figure"');
		expect(currentMdx).toContain(
			'className="docs-course-map-frame" role="region" aria-label="学生考勤课程地图" tabIndex={0}',
		);
		expect(currentMdx).toContain(
			'src="/_docs/regulations/student_rules/student-attendance/2026-current/course-maps/page-0001-map-01.png"',
		);
		expect(currentMdx).toContain('alt="学生考勤课程地图"');
		expect(versionMdx).toContain('versionSlug={"2026-current"}');
		expect(versionMdx).toContain('docsSearchVisibility: "noindex"');
		expect(gatedMdx).toContain("GatedReaderBootstrap");
		expect(gatedMdx).toContain("renderTitle={false}");
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
		expect(currentMdx).toContain('documentSlug={"中央民族大学学生考勤管理规定"}');
		expect(currentMdx).toContain(`routeSlug={"${routeSlug}"}`);
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

		expect(currentMdx).toContain('<ReaderAnchor id={"general\\"reader"} />');
		expect(currentMdx).toContain('<ReaderBlock rootUnitId={"attendance\\"root"}>');
		expect(currentMdx).toContain("学生应按时参加教学活动。");
		expect(currentMdx).not.toContain('<ReaderAnchor id={"general"reader"} />');
		expect(currentMdx).not.toContain('<ReaderBlock rootUnitId={"attendance"root"}>');
	});

	it("renders source-controlled headings as literal single-line MDX text", async () => {
		const { client, manifestPath, root } = createPublishedReaderFixture({
			publicSectionTitle:
				"补充 <img src=x onerror=alert(1)> {globalThis.__docsInjected = true}\nexport const compromised = true",
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
		expect(currentMdx).toContain(
			"## 补充 &lt;img src=x onerror=alert(1)&gt; &#123;globalThis.__docsInjected = true&#125; export const compromised = true",
		);
		expect(currentMdx).not.toContain("\nexport const compromised = true");
		expect(currentMdx).not.toContain("{globalThis.__docsInjected = true}");
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
		const courseMapImage = readFileSync(
			join(
				targetRoot,
				"_docs/regulations/student_rules/student-attendance/2026-current/course-maps/page-0001-map-01.png",
			),
		);
		expect([...courseMapImage.subarray(0, 8)]).toEqual([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		]);
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

	it("rejects legacy or unknown manifest fields", async () => {
		const { client, manifestPath, root } = createPublishedReaderFixture();
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		manifest.generatedAt = "2026-07-16T00:00:00.000Z";
		writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

		await expect(
			syncCampusPublishedReaderAssets({
				client,
				manifestFilePath: manifestPath,
				targetRoot: join(root, "public"),
			}),
		).rejects.toThrow("release manifest has unsupported fields");
	});
});
