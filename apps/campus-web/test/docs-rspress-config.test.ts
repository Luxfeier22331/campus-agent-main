import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PageIndexInfo } from "@rspress/core";
import { describe, expect, it } from "vitest";

import { assertRspressDocsStaticNamespace } from "../scripts/copy-rspress-docs-build.mjs";
import { campusDocsSearchIndexPlugin } from "../scripts/rspress-search-index-plugin";

const appDir = join(__dirname, "..");

describe("campus docs Rspress build boundary", () => {
	it("builds published reader docs for product builds instead of scaffold placeholders", () => {
		const packageJson = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as {
			dependencies: Record<string, string>;
			devDependencies: Record<string, string>;
			scripts: Record<string, string>;
		};
		const configSource = readFileSync(join(appDir, "rspress.config.ts"), "utf8");
		const buildDocsSource = readFileSync(
			join(appDir, "scripts", "build-published-reader-docs.mjs"),
			"utf8",
		);

		expect(packageJson.dependencies["@rspress/core"]).toBeTruthy();
		expect(packageJson.devDependencies.pagefind).toBeUndefined();
		expect(packageJson.scripts["docs:build:scaffold"]).toBeUndefined();
		expect(packageJson.scripts["docs:scaffold"]).toBeUndefined();
		expect(packageJson.scripts["docs:build:published-reader"]).toBeUndefined();
		expect(packageJson.scripts["docs:build:published-reader:staging"]).toBeUndefined();
		expect(packageJson.scripts["docs:pagefind:index"]).toBeUndefined();
		expect(packageJson.scripts["docs:sync:published-reader"]).toBeUndefined();
		expect(packageJson.scripts["docs:sync:published-reader:raw"]).toBeUndefined();
		expect(packageJson.scripts["docs:sync:published-reader:staging"]).toBeUndefined();
		expect(buildDocsSource).toContain("run-with-local-env.mjs");
		expect(buildDocsSource).toContain("sync-campus-published-reader.mjs");
		expect(buildDocsSource).toContain("export-public-docs-sync-manifest.ts");
		expect(buildDocsSource).toContain("--manifest-path");
		expect(buildDocsSource).toContain("../../var/public-docs-sync-manifest.json");
		expect(buildDocsSource).toContain("run-with-staging-ingestion-env.mjs");
		expect(buildDocsSource).toContain("../../var/public-docs-sync-manifest.staging.json");
		expect(buildDocsSource).toContain("rspress");
		expect(buildDocsSource).toContain("filter-rspress-search-index.mjs");
		expect(buildDocsSource).toContain("mirrorPublishedReaderAssetsForRspressBuild");
		expect(buildDocsSource).toContain('"_docs", "_gated-docs", "_gated-docs-search"');
		expect(buildDocsSource).toContain('".generated/docs/public"');
		expect(packageJson.scripts.build).toContain("build-published-reader-docs.mjs");
		expect(packageJson.scripts["build:staging"]).toContain("build-published-reader-docs.mjs");
		expect(packageJson.scripts["build:staging"]).toContain("--staging");
		expect(packageJson.scripts.build).not.toContain("docs:scaffold");
		expect(packageJson.scripts["build:staging"]).not.toContain("docs:scaffold");
		expect(configSource).toContain('logoText: "中央民族大学校园问答"');
		expect(configSource).toContain("locales:");
		expect(configSource).toContain('lang: "zh"');
		expect(configSource).toContain('label: "中文"');
		expect(configSource).toContain("search:");
		expect(configSource).toContain('mode: "local"');
		expect(configSource).toContain("route:");
		expect(configSource).toContain("cleanUrls: true");
		expect(configSource).toContain("rspress-search-hooks");
		expect(configSource).toContain("campusDocsSearchIndexPlugin");
		expect(configSource).toContain("buildRspressSidebarConfig");
		expect(configSource).toContain("buildRspressProductNav");
		expect(configSource).toContain("reader-state-enhancer");
		expect(configSource).toContain("docs-content-enhancer");
		expect(configSource).toContain("docs-account-entry");
		expect(configSource).toContain("mobile-sidebar-guard");
		expect(configSource).not.toContain("pagefind-search");
		expect(configSource).not.toContain("search-keyboard-guard");
		expect(configSource).not.toContain('{ link: "/map", text: "校园地图" }');
	});

	it("copies only docs route assets into campus-web static delivery", () => {
		const copyScript = readFileSync(join(appDir, "scripts", "copy-rspress-docs-build.mjs"), "utf8");

		expect(copyScript).toContain('DOCS_STATIC_ROUTE_ROOT = "_docs-static"');
		expect(copyScript).toContain('for (const routeRoot of ["docs"])');
		expect(copyScript).toContain("RSPRESS_RUNTIME_ROUTE_ROOTS");
		expect(copyScript).not.toContain('["docs", "static"]');
		expect(copyScript).not.toContain('"index.html"');
		expect(copyScript).not.toContain("__campus_docs");
	});

	it("keeps Rspress runtime assets in the docs-owned static namespace", () => {
		const configSource = readFileSync(join(appDir, "rspress.config.ts"), "utf8");
		const gitignore = readFileSync(join(appDir, ".gitignore"), "utf8");

		expect(configSource).toContain('assetPrefix: "/_docs-static/"');
		expect(configSource).toContain('js: "js"');
		expect(configSource).toContain('jsAsync: "js/async"');
		expect(configSource).toContain('css: "css"');
		expect(configSource).toContain('assets: "assets"');
		expect(configSource).not.toContain('root: "_docs-static"');
		expect(configSource).not.toContain('"_docs-static/_docs-static"');
		expect(gitignore).toContain("public/_docs-static/");
		expect(gitignore).not.toContain("public/static/");
	});

	it("rejects Rspress docs builds that still reference the generic static namespace", () => {
		const tempDir = mkdtempSync(join(tmpdir(), "campus-docs-static-"));
		try {
			mkdirSync(join(tempDir, "docs"), { recursive: true });
			mkdirSync(join(tempDir, "js"), { recursive: true });
			writeFileSync(
				join(tempDir, "docs", "index.html"),
				'<script defer src="/static/js/index.bad.js"></script>',
				"utf8",
			);
			writeFileSync(
				join(tempDir, "js", "index.good.js"),
				'__webpack_public_path__="/static/";',
				"utf8",
			);

			expect(() => assertRspressDocsStaticNamespace(tempDir)).toThrow(/generic \/static/);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it("loads local object-store env without importing Worker runtime vars before published reader sync", () => {
		const localEnvScript = readFileSync(join(appDir, "scripts", "run-with-local-env.mjs"), "utf8");

		expect(localEnvScript).toContain('loadRepoEnvFile(import.meta.url, "../../..")');
		expect(localEnvScript).toContain('resolve(appDir, ".env")');
		expect(localEnvScript).toContain("project-local-runtime-env.mjs");
		expect(localEnvScript).toContain("--target");
		expect(localEnvScript).toContain("host");
		expect(localEnvScript).toContain("--skip-hindsight-provider-config");
		expect(localEnvScript).not.toContain('resolve(appDir, ".dev.vars")');
		expect(localEnvScript).not.toContain("minioadmin");
		expect(localEnvScript).not.toContain("OBJECT_STORE_ENDPOINT=");
	});

	it("keeps published reader generated sources out of the tracked scaffold docs root", () => {
		const packageJson = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as {
			scripts: Record<string, string>;
		};
		const buildDocsSource = readFileSync(
			join(appDir, "scripts", "build-published-reader-docs.mjs"),
			"utf8",
		);
		const configSource = readFileSync(join(appDir, "rspress.config.ts"), "utf8");
		const syncSource = readFileSync(
			join(appDir, "scripts", "sync-campus-published-reader.mjs"),
			"utf8",
		);
		const bootstrapSource = readFileSync(
			join(appDir, "scripts", "published-reader-bootstrap-pages.mjs"),
			"utf8",
		);
		const gitignore = readFileSync(join(appDir, ".gitignore"), "utf8");
		const scaffoldDocsRoot = join(appDir, "docs");

		expect(buildDocsSource).toContain('CAMPUS_WEB_RSPRESS_DOCS_ROOT: ".generated/docs"');
		expect(packageJson.scripts["docs:build:scaffold"]).toBeUndefined();
		expect(listFiles(scaffoldDocsRoot)).toEqual([]);
		expect(configSource).toContain("CAMPUS_WEB_RSPRESS_DOCS_ROOT");
		expect(configSource).toContain("builderConfig");
		expect(configSource).toContain('"@": path.resolve(__dirname, "src")');
		expect(syncSource).toContain('".generated/docs"');
		expect(syncSource).toContain("./published-reader-bootstrap-pages.mjs");
		expect(bootstrapSource).toContain("@/components/docs/gated-reader-bootstrap");
		expect(bootstrapSource).toContain("@/components/docs/gated-collection-bootstrap");
		expect(syncSource).not.toContain("CAMPUS_DOCS_SYNC_MANIFEST_PATH");
		expect(syncSource).not.toContain("CAMPUS_DOCS_SYNC_MANIFEST_KEY");
		expect(gitignore).toContain(".generated/");
		expect(gitignore).toContain("public/_docs/");
		expect(gitignore).toContain("public/_gated-docs/");
		expect(gitignore).toContain("public/_gated-docs-search/");
		expect(gitignore).not.toContain("public/pagefind/");
	});

	it("uses campus docs theme styles for reader metadata, versions, and source highlights", () => {
		const themeSource = readFileSync(join(appDir, "theme", "index.tsx"), "utf8");
		const cssSource = readFileSync(join(appDir, "theme", "docs-ui.css"), "utf8");

		expect(themeSource).toContain("Layout as OriginalLayout");
		expect(themeSource).toContain("resolveReaderLayoutClasses");
		expect(cssSource).toContain(".document-meta-panel");
		expect(cssSource).toContain(".docs-version-switcher");
		expect(cssSource).toContain(".reader-block.docs-reader-highlight");
		expect(cssSource).toContain(".rp-doc.rspress-doc table tr:hover");
		expect(cssSource).toContain("background: transparent;");
		expect(cssSource).toContain("var(--sys-brand-interactive,");
		expect(cssSource).toContain("var(--docs-identity,");
		expect(cssSource).not.toContain("公开文档");
		expect(cssSource).not.toContain(".docs-pagefind-");
	});

	it("mounts the docs account entry without depending on the TanStack Router app shell", () => {
		const configSource = readFileSync(join(appDir, "rspress.config.ts"), "utf8");
		const accountEntryPath = join(appDir, "src", "components", "docs", "docs-account-entry.tsx");
		const authProviderPath = join(
			appDir,
			"src",
			"components",
			"auth",
			"browser-auth-ui-provider.tsx",
		);

		expect(configSource).toContain("docs-account-entry");
		expect(existsSync(accountEntryPath)).toBe(true);
		expect(existsSync(authProviderPath)).toBe(true);
		const accountEntrySource = readFileSync(accountEntryPath, "utf8");
		const authProviderSource = readFileSync(authProviderPath, "utf8");
		expect(accountEntrySource).toContain(".rp-nav__right");
		expect(accountEntrySource).not.toContain(".rp-nav__others");
		expect(accountEntrySource).toContain("createPortal");
		expect(accountEntrySource).toContain("@better-auth-ui/heroui");
		expect(accountEntrySource).toContain("<AuthPanel");
		expect(accountEntrySource).toContain("<CampusBrowserAuthUIProvider");
		expect(accountEntrySource).not.toContain("QAAccountEntry");
		expect(accountEntrySource).not.toContain("@tanstack/react-router");
		expect(authProviderSource).toContain("@better-auth-ui/heroui");
		expect(authProviderSource).toContain("window.location");
		expect(authProviderSource).not.toContain("@tanstack/react-router");
		expect(authProviderSource).not.toContain("useNavigate");
	});

	it("keeps Rspress page data while stripping non-public-current search fields", () => {
		const pages = [
			createPageIndexInfo({
				content: "公开正文",
				routePath: "/docs/public",
				title: "公开标题",
				visibility: "public_current",
			}),
			createPageIndexInfo({
				content: "受限正文",
				routePath: "/docs/restricted",
				title: "受限标题",
				visibility: "gated_bootstrap",
			}),
		];

		campusDocsSearchIndexPlugin().modifySearchIndexData?.(pages, true);

		expect(pages).toHaveLength(2);
		expect(pages[0]).toMatchObject({
			content: "公开正文",
			routePath: "/docs/public",
			title: "公开标题",
		});
		expect(pages[1]).toMatchObject({
			content: "",
			routePath: "/docs/restricted",
			title: "",
			toc: [],
		});
	});
});

function listFiles(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}
	const files: string[] = [];
	for (const entry of readdirSync(root)) {
		const absolutePath = join(root, entry);
		const stat = statSync(absolutePath);
		if (stat.isDirectory()) {
			for (const child of listFiles(absolutePath)) {
				files.push(join(entry, child));
			}
			continue;
		}
		files.push(entry);
	}
	return files.sort();
}

function createPageIndexInfo(input: {
	content: string;
	routePath: string;
	title: string;
	visibility: string;
}): PageIndexInfo {
	return {
		_filepath: `/tmp${input.routePath}.mdx`,
		_flattenContent: input.content,
		_relativePath: `${input.routePath}.mdx`,
		content: input.content,
		frontmatter: { docsSearchVisibility: input.visibility },
		lang: "zh",
		routePath: input.routePath,
		title: input.title,
		toc: [{ charIndex: 0, depth: 2, id: "section", text: "章节" }],
		version: "",
	} as PageIndexInfo;
}
