import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeNativeDocsHtmlPages } from "../src/docs-reader-build/native-reader-prerender.tsx";
import {
	isMissingObjectError,
	resolvePublishedReaderObjectStoreBucket,
	resolvePublishedReaderObjectStoreConfig,
	resolvePublishedReaderObjectStoreCredentials,
	resolvePublishedReaderObjectStoreWriterConfig,
	resolvePublishedReaderObjectStoreWriterCredentials,
} from "../src/docs-reader-build/published-reader-object-store.ts";
import { compileDocsSource } from "../src/docs-reader-build/source-compiler.ts";
import { syncCompiledCampusPublishedReader } from "../src/docs-reader-build/sync-campus-published-reader.ts";
import {
	cleanupPublishedReaderFixture,
	createPublishedReaderFixture,
	type PublishedReaderFixtureInput,
} from "./helpers/published-reader-fixture";

afterEach(cleanupPublishedReaderFixture);

describe("campus-web published reader sync", () => {
	it("uses the canonical derived object store bucket", () => {
		expect(resolvePublishedReaderObjectStoreBucket({})).toBe("campus-agent-derived");
	});

	it("uses the same isolated bucket for reader and writer configurations", () => {
		const env = {
			OBJECT_STORE_BUCKET_DERIVED: "campus-agent-derived-wt-1",
			OBJECT_STORE_ENDPOINT: "http://localhost:9000",
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "reader",
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: "reader-secret",
			OBJECT_STORE_DERIVED_ACCESS_KEY: "writer",
			OBJECT_STORE_DERIVED_SECRET_KEY: "writer-secret",
		};
		expect(resolvePublishedReaderObjectStoreConfig(env).bucket).toBe(
			env.OBJECT_STORE_BUCKET_DERIVED,
		);
		expect(resolvePublishedReaderObjectStoreWriterConfig(env).bucket).toBe(
			env.OBJECT_STORE_BUCKET_DERIVED,
		);
	});

	it("resolves object store config from the derived identity", () => {
		expect(
			resolvePublishedReaderObjectStoreConfig({
				OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "derived-read-access",
				OBJECT_STORE_DERIVED_READ_SECRET_KEY: "derived-read-secret",
				OBJECT_STORE_ENDPOINT: "http://localhost:9000",
			}),
		).toMatchObject({
			accessKeyId: "derived-read-access",
			bucket: "campus-agent-derived",
			credentialMode: "derived",
			endpoint: "http://localhost:9000",
			region: "us-east-1",
			secretAccessKey: "derived-read-secret",
		});
	});

	it("uses derived bucket credentials for published reader object store access", () => {
		expect(
			resolvePublishedReaderObjectStoreCredentials({
				OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "derived-read-access",
				OBJECT_STORE_DERIVED_READ_SECRET_KEY: "derived-read-secret",
			}),
		).toEqual({
			accessKeyId: "derived-read-access",
			credentialMode: "derived",
			secretAccessKey: "derived-read-secret",
		});
	});

	it("keeps writer credentials separate from reader credentials", () => {
		expect(
			resolvePublishedReaderObjectStoreWriterConfig({
				OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-write-access",
				OBJECT_STORE_DERIVED_SECRET_KEY: "derived-write-secret",
				OBJECT_STORE_ENDPOINT: "http://localhost:9000",
			}),
		).toMatchObject({
			accessKeyId: "derived-write-access",
			secretAccessKey: "derived-write-secret",
		});
		expect(
			resolvePublishedReaderObjectStoreWriterCredentials({
				OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-write-access",
				OBJECT_STORE_DERIVED_SECRET_KEY: "derived-write-secret",
			}),
		).toEqual({
			accessKeyId: "derived-write-access",
			credentialMode: "derived",
			secretAccessKey: "derived-write-secret",
		});
	});

	it("fails closed when object store credentials are incomplete", () => {
		expect(() =>
			resolvePublishedReaderObjectStoreConfig({
				OBJECT_STORE_ENDPOINT: "http://localhost:9000",
			}),
		).toThrow("OBJECT_STORE_DERIVED_READ_ACCESS_KEY is required");
	});

	it("only treats S3 NoSuchKey errors as missing objects", () => {
		expect(isMissingObjectError({ name: "NoSuchKey" })).toBe(true);
		expect(isMissingObjectError({ Code: "NoSuchKey" })).toBe(true);
		expect(
			isMissingObjectError({
				name: "UnknownError",
				$metadata: { httpStatusCode: 404 },
			}),
		).toBe(false);
	});

	it("generates the native catalog, indexes, and readable HTML pages", async () => {
		const output = await buildNativeReaderFixture();

		expect(output.syncResult).toMatchObject({
			generatedDocumentCount: 3,
		});
		expect(output.pageCount).toBe(7);
		const catalog = readJson<{
			routes: Array<{
				canonicalUrl: string;
				documentSlug: string;
				routeSlug: string;
				versions: Array<{ canonicalUrl: string; versionSlug: string }>;
			}>;
			schemaVersion: string;
			siteIndex: {
				collections: Array<{ documents: unknown[] }>;
				searchIndexUrl: string;
			};
		}>(join(output.generatedRoot, "catalog.json"));
		expect(catalog.schemaVersion).toBe("campus_docs_native_catalog.v5");
		expect(catalog.routes).toHaveLength(5);
		const currentPublicRoute = catalog.routes.find(
			(route) => route.canonicalUrl === "/docs/regulations/student_rules/student-attendance",
		);
		expect(currentPublicRoute).toMatchObject({
			canonicalUrl: "/docs/regulations/student_rules/student-attendance",
			documentSlug: "student-attendance",
			routeSlug: "student-attendance",
		});
		expect(
			catalog.routes.find(
				(route) =>
					route.canonicalUrl === "/docs/regulations/student_rules/student-attendance/v/2026",
			),
		).toMatchObject({
			documentSlug: "student-attendance",
			routeSlug: "student-attendance",
		});
		expect(currentPublicRoute?.versions).toEqual([
			{
				canonicalUrl: "/docs/regulations/student_rules/student-attendance",
				versionId: "version_public",
				versionSlug: "2026",
			},
			{
				canonicalUrl: "/docs/regulations/student_rules/student-attendance/v/2025",
				versionId: "version_public_history",
				versionSlug: "2025",
			},
		]);

		const siteIndexText = readFileSync(join(output.publicRoot, "_docs/site-index.json"), "utf8");
		const publicSearchText = readFileSync(
			join(output.publicRoot, catalog.siteIndex.searchIndexUrl),
			"utf8",
		);
		expect(JSON.parse(siteIndexText)).toEqual(catalog.siteIndex);
		expect(siteIndexText).toContain("leave-policy");
		expect(publicSearchText).toContain("campus_docs_search_index.v3");
		expect(publicSearchText).toContain("学生应按时参加教学活动");
		expect(publicSearchText).toContain("六、课程地图");
		expect(publicSearchText).toContain("course-map-heading");
		expect(publicSearchText).toContain("学生请假应按规定办理手续");

		const directoryHtml = readFileSync(join(output.pagesRoot, "index.html"), "utf8");
		const publicHtml = readFileSync(
			join(output.pagesRoot, "regulations/student_rules/student-attendance/index.html"),
			"utf8",
		);
		const historicalHtml = readFileSync(
			join(output.pagesRoot, "regulations/student_rules/student-attendance/v/2025/index.html"),
			"utf8",
		);
		const currentVersionHtml = readFileSync(
			join(output.pagesRoot, "regulations/student_rules/student-attendance/v/2026/index.html"),
			"utf8",
		);
		const secondaryHtml = readFileSync(
			join(output.pagesRoot, "regulations/student_rules/leave-policy/index.html"),
			"utf8",
		);
		const notFoundHtml = readFileSync(join(output.pagesRoot, "404.html"), "utf8");
		expect(directoryHtml).toContain("校园文档");
		expect(directoryHtml).toContain('data-campus-prerendered="docs"');
		expect(existsSync(join(output.pagesRoot, "regulations/index.html"))).toBe(false);
		expect(existsSync(join(output.pagesRoot, "regulations/student_rules/index.html"))).toBe(false);
		expect(publicHtml).toContain("学生应按时参加教学活动");
		expect(publicHtml).toContain("校级社会实践");
		expect(publicHtml).toContain("学生考勤课程地图");
		expect(publicHtml).toContain('width="1233"');
		expect(publicHtml).toContain('height="649"');
		expect(publicHtml).toContain("查看大图");
		expect(publicHtml).toContain("&lt;img src=x onerror=alert(1)&gt;");
		expect(publicHtml).toContain('name="docs-version"');
		const publicBody =
			publicHtml.split('<div class="docs-document-body">')[1]?.split("<template")[0] ?? "";
		expect(publicHtml).toContain("<dd>民大校发〔2026〕1号</dd>");
		expect(publicBody).toContain("学生应按时参加教学活动");
		expect(publicBody).not.toContain("民大校发〔2026〕1号");
		expect(publicBody).toContain("为规范学生考勤，制定本规定。");
		expect(historicalHtml).toContain('data-root-unit-id="document-number"');
		expect(publicHtml).toContain('<time dateTime="2026-09-01">2026 年 9 月 1 日</time>');
		expect(publicHtml).toContain('href="https://xxgk.muc.edu.cn/info/1/1.htm"');
		expect(historicalHtml).not.toContain('class="document-meta-details"');
		expect(secondaryHtml).not.toContain('class="document-meta-details"');
		expect(publicHtml).toContain(
			'<link rel="canonical" href="https://chat.muc.wiki/docs/regulations/student_rules/student-attendance"',
		);
		expect(publicHtml).toContain('<script type="module" src="/src/docs-main.tsx"></script>');
		expect(currentVersionHtml).toContain("学生应按时参加教学活动");
		expect(currentVersionHtml).toContain(
			'<link rel="canonical" href="https://chat.muc.wiki/docs/regulations/student_rules/student-attendance"',
		);
		expect(historicalHtml).toContain("正在阅读历史版本，请以当前版为准。");
		expect(secondaryHtml).toContain('content="index,follow"');
		expect(secondaryHtml).toContain('<template id="campus-docs-route-bootstrap">');
		expect(secondaryHtml).not.toContain('<script id="campus-docs-route-bootstrap"');
		expect(secondaryHtml).not.toContain("tsr-scroll-restoration");
		expect(secondaryHtml).toContain("学生请假应按规定办理手续");
		expect(secondaryHtml).toContain('"siteIndex"');
		expect(notFoundHtml).toContain("文档不存在");
		expect(notFoundHtml).toContain('content="noindex,nofollow"');
		expect(notFoundHtml).not.toContain('rel="canonical"');
		const headers = readFileSync(join(output.publicRoot, "_headers"), "utf8");
		expect(headers).toMatch(/^\/docs\n/u);
		expect(headers).toContain("\n/docs/*\n");
		expect(headers.match(/script-src [^;\n]*/gu)).toEqual([
			"script-src 'self' https://static.cloudflareinsights.com",
			"script-src 'self' https://static.cloudflareinsights.com",
		]);
		expect(readFileSync(join(output.publicRoot, "_redirects"), "utf8")).toBe("");
	});

	it("prerenders the docs shell navigation synchronously without suspend markers", async () => {
		const output = await buildNativeReaderFixture();
		const directoryHtml = readFileSync(join(output.pagesRoot, "index.html"), "utf8");
		const publicHtml = readFileSync(
			join(output.pagesRoot, "regulations/student_rules/student-attendance/index.html"),
			"utf8",
		);

		for (const pageHtml of [directoryHtml, publicHtml]) {
			expect(pageHtml).toContain('data-campus-prerendered="docs"');
			expect(pageHtml).toContain('data-slot="product-nav-mobile-trigger"');
			expect(pageHtml).toContain('aria-label="打开全局菜单"');
			expect(pageHtml).not.toContain("data-msg");
			expect(pageHtml).not.toContain("<!--$?-->");
		}
	});

	it("does not prerender curriculum corpus or collection directories", async () => {
		const output = await buildNativeReaderFixture({
			publicCollection: "undergraduate",
			publicCollectionLabel: "本科培养方案",
			publicCorpus: "curriculum",
		});

		expect(output.pageCount).toBe(7);
		expect(existsSync(join(output.pagesRoot, "curriculum/index.html"))).toBe(false);
		expect(existsSync(join(output.pagesRoot, "curriculum/undergraduate/index.html"))).toBe(false);
	});

	it("materializes non-ASCII document slugs under stable route-safe URLs", async () => {
		const output = await buildNativeReaderFixture({
			publicDocumentSlug: "中央民族大学学生考勤管理规定",
		});
		const catalog = readJson<{
			routes: Array<{
				canonicalUrl: string;
				documentSlug: string;
				routeSlug: string;
			}>;
		}>(join(output.generatedRoot, "catalog.json"));
		const current = catalog.routes.find(
			(route) =>
				route.canonicalUrl.split("/").filter(Boolean).length === 4 &&
				route.documentSlug === "中央民族大学学生考勤管理规定",
		);

		expect(current?.documentSlug).toBe("中央民族大学学生考勤管理规定");
		expect(current?.routeSlug).toMatch(/^doc-[a-f0-9]{12}$/u);
		expect(current?.canonicalUrl).toBe(`/docs/regulations/student_rules/${current?.routeSlug}`);
		expect(
			existsSync(
				join(output.pagesRoot, `regulations/student_rules/${current?.routeSlug}/index.html`),
			),
		).toBe(true);
	});

	it("places course maps after matching paragraph-shaped source headings", async () => {
		const output = await buildNativeReaderFixture({
			publicCourseMapParentKind: "paragraph",
		});
		const publicHtml = readFileSync(
			join(output.pagesRoot, "regulations/student_rules/student-attendance/index.html"),
			"utf8",
		);

		expect(publicHtml).toContain("六、课程地图");
		expect(publicHtml).toContain("学生考勤课程地图");
		expect(publicHtml.indexOf("六、课程地图")).toBeLessThan(publicHtml.indexOf("学生考勤课程地图"));
	});

	it("serializes source-controlled text as text instead of executable markup", async () => {
		const output = await buildNativeReaderFixture({
			publicReaderAnchor: 'general"reader',
			publicReaderRootUnitId: 'attendance"root',
			publicSectionTitle: "补充 <img src=x onerror=alert(1)> {globalThis.__docsInjected = true}",
		});
		const publicHtml = readFileSync(
			join(output.pagesRoot, "regulations/student_rules/student-attendance/index.html"),
			"utf8",
		);

		expect(publicHtml).toContain('id="general&quot;reader"');
		expect(publicHtml).toContain('data-root-unit-id="attendance&quot;root"');
		expect(publicHtml).toContain("&lt;img src=x onerror=alert(1)&gt;");
		expect(publicHtml).not.toContain("<img src=x onerror=alert(1)>");
		expect(publicHtml).not.toContain("<script>globalThis.__docsInjected");
	});

	it("copies published reader assets into campus-web static delivery roots", async () => {
		const { client, source, root } = createPublishedReaderFixture();
		const targetRoot = join(root, "public");

		const result = await syncCompiledCampusPublishedReader({
			compiled: await compileDocsSource({ client, source }),
			docsRoot: join(root, "generated"),
			targetRoot,
		});

		expect(result.assets).toMatchObject({
			copiedAssetCount: 7,
			copiedDocumentCount: 3,
		});
		expect(
			readFileSync(
				join(targetRoot, "_docs/regulations/student_rules/student-attendance/2026/reader.json"),
				"utf8",
			),
		).toContain("attendance-root");
		expect(
			readFileSync(
				join(targetRoot, "_docs/regulations/student_rules/leave-policy/2026/reader.json"),
				"utf8",
			),
		).toContain("leave-policy-root");
		const courseMapImage = readFileSync(
			join(
				targetRoot,
				"_docs/regulations/student_rules/student-attendance/2026/course-maps/page-0001-map-01.png",
			),
		);
		expect([...courseMapImage.subarray(0, 8)]).toEqual([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		]);
		const courseMaps = readJson<{
			docId: string;
			maps: Array<{
				parts: Array<{ height: number; imagePath: string; width: number }>;
				targetRootUnitId: string;
			}>;
			schemaVersion: string;
			versionId: string;
		}>(
			join(targetRoot, "_docs/regulations/student_rules/student-attendance/2026/course-maps.json"),
		);
		expect(courseMaps).toMatchObject({
			docId: "doc_public",
			maps: [
				{
					parts: [
						{
							height: 649,
							imagePath: "course-maps/page-0001-map-01.png",
							width: 1233,
						},
					],
					targetRootUnitId: "course-map-heading",
				},
			],
			schemaVersion: "campus_docs_course_maps.v1",
			versionId: "version_public",
		});
		expect(existsSync(join(targetRoot, "_gated-docs"))).toBe(false);
		expect(existsSync(join(targetRoot, "_gated-docs-search"))).toBe(false);
	});

	it("rejects missing source objects before generating assets", async () => {
		const { client, source } = createPublishedReaderFixture({
			missingObjects: ["reader/public.json"],
		});
		await expect(compileDocsSource({ client, source })).rejects.toThrow(
			"missing published reader object: reader/public.json",
		);
	});

	it("keeps existing assets and catalog when compiling a replacement fails", async () => {
		const { client, source, root } = createPublishedReaderFixture();
		const targetRoot = join(root, "public");
		const docsRoot = join(root, "generated");
		await syncCompiledCampusPublishedReader({
			compiled: await compileDocsSource({ client, source }),
			targetRoot,
			docsRoot,
		});
		const assetPath = join(
			targetRoot,
			"_docs/regulations/student_rules/student-attendance/2026/reader.json",
		);
		const catalogPath = join(docsRoot, "catalog.json");
		const asset = readFileSync(assetPath, "utf8");
		const catalog = readFileSync(catalogPath, "utf8");
		const replacement = async () =>
			syncCompiledCampusPublishedReader({
				compiled: await compileDocsSource({
					source,
					client: {
						readOptionalBytesObject: ({ key }) =>
							key === "reader/public.json"
								? Promise.resolve(undefined)
								: client.readOptionalBytesObject({ key }),
					},
				}),
				targetRoot,
				docsRoot,
			});
		await expect(replacement()).rejects.toThrow(
			"missing published reader object: reader/public.json",
		);
		expect(readFileSync(assetPath, "utf8")).toBe(asset);
		expect(readFileSync(catalogPath, "utf8")).toBe(catalog);
	});
});

async function buildNativeReaderFixture(input: PublishedReaderFixtureInput = {}) {
	const fixture = createPublishedReaderFixture(input);
	const generatedRoot = join(fixture.root, "generated");
	const pagesRoot = join(fixture.root, "pages");
	const publicRoot = join(fixture.root, "public");
	const { docs: syncResult } = await syncCompiledCampusPublishedReader({
		compiled: await compileDocsSource({ client: fixture.client, source: fixture.source }),
		docsRoot: generatedRoot,
		targetRoot: publicRoot,
	});
	const { pageCount } = await writeNativeDocsHtmlPages({
		generatedRoot,
		pagesRoot,
		publicRoot,
	});
	return { generatedRoot, pageCount, pagesRoot, publicRoot, syncResult };
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}
