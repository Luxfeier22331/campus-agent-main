import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { createDocsSourceSiteFixture } from "campus-contracts/campus-docs/fixture";
import { DOCS_SOURCE_KEY, selectCurrentVersion } from "campus-contracts/campus-docs/node";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCampusWebDocsShard, selectDocsShard } from "../config/docs-shard.ts";
import { parseCampusWebBuildArgs } from "../scripts/build-campus-web.ts";
import {
	parsePrepareDocsContentArgs,
	prepareDocsContent,
} from "../scripts/prepare-docs-content.ts";
import {
	DOCS_CONTENT_SCHEMA,
	resolveSourceDocsContentPaths,
} from "../src/docs-reader-build/docs-content.ts";

let appRoot: string | null = null;
const themeBootstrapSourcePath = join(__dirname, "../../../packages/ui/src/theme-bootstrap.js");

afterEach(() => {
	if (appRoot) {
		rmSync(appRoot, { force: true, recursive: true });
		appRoot = null;
	}
});

describe("Campus Web 文档内容准备合同", () => {
	it("只接受页面生成和强制刷新参数", () => {
		expect(parsePrepareDocsContentArgs([])).toEqual({ pages: false, refresh: false });
		expect(parsePrepareDocsContentArgs(["--pages", "--refresh"])).toEqual({
			pages: true,
			refresh: true,
		});
		expect(() => parsePrepareDocsContentArgs(["--fixture"])).toThrow(
			"unknown docs content argument",
		);
		expect(() => parsePrepareDocsContentArgs(["--source-digest", "sha256:abc"])).toThrow(
			"unknown docs content argument",
		);
	});

	it("按来源摘要隔离本地生成内容", () => {
		const root = createAppRoot();
		const digest = `sha256:${"b".repeat(64)}`;

		expect(resolveSourceDocsContentPaths(root, digest).root).toBe(
			join(root, ".generated/docs-content/sources", `sha256-${"b".repeat(64)}`),
		);
	});

	it("从固定来源键准备完整文档目录，并按需生成静态页面", async () => {
		const fixture = createDocsSourceSiteFixture();
		const content = await prepareDocsContent({
			appRoot: createAppRoot(),
			client: fixture.client,
			pages: false,
			refresh: true,
		});
		const catalog = JSON.parse(
			readFileSync(join(content.generatedRoot, "catalog.json"), "utf8"),
		) as {
			routes: Array<{
				canonicalUrl: string;
				versionId: string;
				versionSlug: string;
			}>;
			siteIndex: { collections: Array<{ documents: unknown[] }> };
		};
		const latestVersionIds = new Set(
			fixture.source.documents
				.map((document) =>
					selectCurrentVersion(
						fixture.source.versions.filter((version) => version.docId === document.docId),
						document.docId,
					),
				)
				.map((version) => version.versionId),
		);

		expect(content.root).toBe(
			resolveSourceDocsContentPaths(appRoot ?? "", fixture.sourceDigest).root,
		);
		expect(catalog.routes).toHaveLength(fixture.source.versions.length + latestVersionIds.size);
		for (const version of fixture.source.versions.filter((item) =>
			latestVersionIds.has(item.versionId),
		)) {
			const routes = catalog.routes.filter((route) => route.versionId === version.versionId);
			expect(routes).toHaveLength(2);
			expect(routes.some((route) => route.canonicalUrl.endsWith(`/v/${version.versionSlug}`))).toBe(
				true,
			);
			expect(routes.some((route) => !route.canonicalUrl.includes("/v/"))).toBe(true);
		}
		expect(catalog.siteIndex.collections).toHaveLength(6);
		expect(
			catalog.siteIndex.collections.flatMap((collection) => collection.documents),
		).toHaveLength(24);
		expect(existsSync(content.pagesRoot)).toBe(false);
		const metadata = JSON.parse(readFileSync(content.metadataPath, "utf8")) as {
			files: string[];
			schemaVersion: string;
			sourceDigest: string;
		};
		expect(metadata).toMatchObject({
			schemaVersion: DOCS_CONTENT_SCHEMA,
			sourceDigest: fixture.sourceDigest,
		});
		expect(metadata.files).toContain("build/catalog.json");
		expect(metadata.files).toContain("public/_docs/site-index.json");
		expect(metadata.files.some((file) => file.endsWith("/reader.json"))).toBe(true);
		expect(metadata.files.some((file) => file.includes("/_docs/search/sha256/"))).toBe(true);

		await prepareDocsContent({
			...(appRoot ? { appRoot } : {}),
			client: fixture.client,
			pages: true,
			refresh: false,
		});
		expect(
			existsSync(
				join(content.pagesRoot, "regulations/student_rules/doc-c62077b20430/v/2025/index.html"),
			),
		).toBe(true);
		expect(existsSync(join(content.pagesRoot, "regulations/index.html"))).toBe(false);
		expect(existsSync(join(content.pagesRoot, "404.html"))).toBe(true);
	});

	it("compiles each source object once and reuses compiled readers and bytes", async () => {
		const fixture = createDocsSourceSiteFixture();
		const reads = new Map<string, number>();
		let active = 0;
		let peak = 0;
		const client = {
			readOptionalBytesObject: async ({ key }: { key: string }) => {
				reads.set(key, (reads.get(key) ?? 0) + 1);
				active += 1;
				peak = Math.max(peak, active);
				await setImmediate();
				active -= 1;
				return fixture.client.readOptionalBytesObject({ key });
			},
		};

		const content = await prepareDocsContent({
			appRoot: createAppRoot(),
			client,
			pages: false,
			refresh: true,
		});

		for (const key of fixture.objects.keys()) {
			if (key !== DOCS_SOURCE_KEY) {
				expect(reads.get(key)).toBe(1);
			}
		}
		expect(reads.get(DOCS_SOURCE_KEY)).toBe(1);
		expect(peak).toBeGreaterThan(1);
		expect(existsSync(join(content.root, "input/objects"))).toBe(false);
		const imageReferences = fixture.source.versions.flatMap((version) =>
			version.supplements.flatMap((supplement) =>
				supplement.assets.map((asset) => asset.object.key),
			),
		);
		expect(imageReferences.length).toBeGreaterThan(new Set(imageReferences).size);
	});

	it("在文档内容缓存命中时校准主题启动脚本", async () => {
		const fixture = createDocsSourceSiteFixture();
		const content = await prepareDocsContent({
			appRoot: createAppRoot(),
			client: fixture.client,
			pages: false,
			refresh: true,
		});
		const themeBootstrapPath = join(content.publicRoot, "theme-bootstrap.js");
		rmSync(themeBootstrapPath);
		expect(existsSync(themeBootstrapPath)).toBe(false);

		await prepareDocsContent({
			...(appRoot ? { appRoot } : {}),
			client: fixture.client,
			pages: false,
			refresh: false,
		});

		expect(readFileSync(themeBootstrapPath, "utf8")).toBe(
			readFileSync(themeBootstrapSourcePath, "utf8"),
		);
	});

	it("在完整内容清单中的公开文件缺失时重新准备内容", async () => {
		const fixture = createDocsSourceSiteFixture();
		const content = await prepareDocsContent({
			appRoot: createAppRoot(),
			client: fixture.client,
			pages: true,
			refresh: true,
		});
		const metadata = JSON.parse(readFileSync(content.metadataPath, "utf8")) as { files: string[] };
		const reader = metadata.files.find((file) => file.endsWith("/reader.json"));
		if (!reader) {
			throw new Error("prepared docs fixture is missing a reader asset");
		}
		rmSync(join(content.root, reader));

		await prepareDocsContent({
			...(appRoot ? { appRoot } : {}),
			client: fixture.client,
			pages: true,
			refresh: false,
		});

		expect(existsSync(join(content.root, reader))).toBe(true);
	});

	it("拒绝固定来源键中的非规范 JSON", async () => {
		const fixture = createDocsSourceSiteFixture();
		const nonCanonicalSource = new TextEncoder().encode(JSON.stringify(fixture.source));

		await expect(
			prepareDocsContent({
				appRoot: createAppRoot(),
				client: {
					readOptionalBytesObject: ({ key }) =>
						key === DOCS_SOURCE_KEY
							? Promise.resolve(nonCanonicalSource)
							: fixture.client.readOptionalBytesObject({ key }),
				},
				pages: false,
				refresh: false,
			}),
		).rejects.toThrow(`${DOCS_SOURCE_KEY} must contain canonical campus_docs_source.v4 JSON`);
	});

	it("在对象存储缺少固定来源键时明确失败", async () => {
		await expect(
			prepareDocsContent({
				appRoot: createAppRoot(),
				client: { readOptionalBytesObject: async () => undefined },
				pages: false,
				refresh: false,
			}),
		).rejects.toThrow(`missing campus docs source catalog: ${DOCS_SOURCE_KEY}`);
	});

	it("构建不接受手工文档来源参数", () => {
		expect(parseCampusWebBuildArgs([])).toEqual({ staging: false });
		expect(parseCampusWebBuildArgs(["--staging"])).toEqual({ staging: true });
		expect(() => parseCampusWebBuildArgs(["--source-digest", "sha256:abc"])).toThrow(
			"unknown campus web build argument",
		);
	});
});

describe("Campus Web 文档分片构建", () => {
	it("缺省不分片，并拒绝越界或非法的分片配置", () => {
		expect(resolveCampusWebDocsShard({})).toEqual({ index: 0, total: 1 });
		expect(
			resolveCampusWebDocsShard({
				CAMPUS_WEB_DOCS_SHARD_INDEX: "2",
				CAMPUS_WEB_DOCS_SHARD_TOTAL: "6",
			}),
		).toEqual({ index: 2, total: 6 });
		expect(() =>
			resolveCampusWebDocsShard({
				CAMPUS_WEB_DOCS_SHARD_INDEX: "6",
				CAMPUS_WEB_DOCS_SHARD_TOTAL: "6",
			}),
		).toThrow("CAMPUS_WEB_DOCS_SHARD_INDEX");
		expect(() =>
			resolveCampusWebDocsShard({
				CAMPUS_WEB_DOCS_SHARD_INDEX: "0",
				CAMPUS_WEB_DOCS_SHARD_TOTAL: "0",
			}),
		).toThrow("CAMPUS_WEB_DOCS_SHARD_TOTAL");
	});

	it("分片覆盖全部页面且互不重复，入口页出现在每个分片", () => {
		const inputs = Object.fromEntries(
			["docs/index", "docs/404", ...Array.from({ length: 20 }, (_, i) => `docs/page-${i}`)].map(
				(route) => [route, `/src/${route}.html`],
			),
		);
		const total = 6;
		const shards = Array.from({ length: total }, (_, index) =>
			selectDocsShard(inputs, { index, total }),
		);

		for (const shard of shards) {
			expect(Object.keys(shard)).toContain("docs/index");
			expect(Object.keys(shard)).toContain("docs/404");
		}
		const pageRoutes = Object.keys(inputs).filter((route) => route.startsWith("docs/page-"));
		const covered = shards.flatMap((shard) =>
			Object.keys(shard).filter((route) => route.startsWith("docs/page-")),
		);
		expect(covered.slice().sort()).toEqual(pageRoutes.slice().sort());
		expect(new Set(covered).size).toBe(covered.length);
	});

	it("单分片时返回完整输入", () => {
		const inputs = { "docs/404": "b", "docs/index": "a", "docs/page-0": "c" };
		expect(selectDocsShard(inputs, { index: 0, total: 1 })).toEqual(inputs);
	});
});

function createAppRoot(): string {
	appRoot = mkdtempSync(join(tmpdir(), "campus-web-docs-content-"));
	return appRoot;
}
