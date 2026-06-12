import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = join(__dirname, "..");

describe("campus docs Rspress build boundary", () => {
	it("builds published reader docs for product builds instead of scaffold placeholders", () => {
		const packageJson = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as {
			dependencies: Record<string, string>;
			devDependencies: Record<string, string>;
			scripts: Record<string, string>;
		};
		const configSource = readFileSync(join(appDir, "rspress.config.ts"), "utf8");

		expect(packageJson.dependencies["@rspress/core"]).toBeTruthy();
		expect(packageJson.devDependencies.pagefind).toBeTruthy();
		expect(packageJson.scripts["docs:build:scaffold"]).toContain("docs:scaffold");
		expect(packageJson.scripts["docs:build:published-reader"]).toContain(
			"docs:sync:published-reader",
		);
		expect(packageJson.scripts["docs:build:published-reader:staging"]).toContain(
			"docs:sync:published-reader:staging",
		);
		expect(packageJson.scripts["docs:pagefind:index"]).toContain("pagefind");
		expect(packageJson.scripts["docs:pagefind:index"]).toContain("--site public");
		expect(packageJson.scripts["docs:pagefind:index"]).toContain("--output-subdir pagefind");
		expect(packageJson.scripts["docs:build:published-reader"]).toContain("docs:pagefind:index");
		expect(packageJson.scripts["docs:build:published-reader:staging"]).toContain(
			"docs:pagefind:index",
		);
		expect(packageJson.scripts["docs:sync:published-reader"]).toContain("run-with-local-env.mjs");
		expect(packageJson.scripts["docs:sync:published-reader"]).toContain(
			"docs:sync:published-reader:raw",
		);
		expect(packageJson.scripts["docs:sync:published-reader:raw"]).not.toContain(
			"run-with-local-env.mjs",
		);
		expect(packageJson.scripts["docs:sync:published-reader:staging"]).toContain(
			"run-with-staging-ingestion-env.mjs",
		);
		expect(packageJson.scripts["docs:sync:published-reader:staging"]).toContain(
			"docs:sync:published-reader:raw",
		);
		expect(packageJson.scripts["docs:build:published-reader"]).toContain("rspress build");
		expect(packageJson.scripts.build).toContain("pnpm docs:build:published-reader");
		expect(packageJson.scripts["build:staging"]).toContain(
			"pnpm docs:build:published-reader:staging",
		);
		expect(packageJson.scripts.build).not.toContain("docs:scaffold");
		expect(packageJson.scripts["build:staging"]).not.toContain("docs:scaffold");
		expect(configSource).toContain('logoText: "中央民族大学校园问答"');
		expect(configSource).not.toContain('mode: "local"');
		expect(configSource).not.toContain("search:");
		expect(configSource).not.toContain("docs-search-hook");
		expect(configSource).toContain("buildRspressSidebarConfig");
		expect(configSource).toContain("reader-state-enhancer");
		expect(configSource).toContain("docs-content-enhancer");
		expect(configSource).toContain("mobile-sidebar-guard");
		expect(configSource).toContain("pagefind-search");
		expect(configSource).not.toContain("search-keyboard-guard");
	});

	it("copies only docs route assets into campus-web static delivery", () => {
		const copyScript = readFileSync(join(appDir, "scripts", "copy-rspress-docs-build.mjs"), "utf8");

		expect(copyScript).toContain('for (const routeRoot of ["docs", "static"])');
		expect(copyScript).not.toContain('"index.html"');
		expect(copyScript).not.toContain("__campus_docs");
	});

	it("loads local repo and app env before published reader sync", () => {
		const localEnvScript = readFileSync(join(appDir, "scripts", "run-with-local-env.mjs"), "utf8");

		expect(localEnvScript).toContain('loadRepoEnvFile(import.meta.url, "../../..")');
		expect(localEnvScript).toContain('resolve(appDir, ".env")');
		expect(localEnvScript).toContain('resolve(appDir, ".dev.vars")');
		expect(localEnvScript).not.toContain("minioadmin");
		expect(localEnvScript).not.toContain("OBJECT_STORE_ENDPOINT=");
	});

	it("keeps published reader generated sources out of the tracked scaffold docs root", () => {
		const packageJson = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as {
			scripts: Record<string, string>;
		};
		const configSource = readFileSync(join(appDir, "rspress.config.ts"), "utf8");
		const syncSource = readFileSync(
			join(appDir, "scripts", "sync-campus-published-reader.mjs"),
			"utf8",
		);
		const gitignore = readFileSync(join(appDir, ".gitignore"), "utf8");

		expect(packageJson.scripts["docs:build:published-reader"]).toContain(
			"CAMPUS_WEB_RSPRESS_DOCS_ROOT=.generated/docs",
		);
		expect(packageJson.scripts["docs:build:published-reader:staging"]).toContain(
			"CAMPUS_WEB_RSPRESS_DOCS_ROOT=.generated/docs",
		);
		expect(packageJson.scripts["docs:build:scaffold"]).not.toContain(
			"CAMPUS_WEB_RSPRESS_DOCS_ROOT=.generated/docs",
		);
		expect(configSource).toContain("CAMPUS_WEB_RSPRESS_DOCS_ROOT");
		expect(configSource).toContain("builderConfig");
		expect(configSource).toContain('"@": path.resolve(__dirname, "src")');
		expect(syncSource).toContain('".generated/docs"');
		expect(syncSource).toContain("@/components/docs/gated-reader-bootstrap");
		expect(syncSource).toContain("@/components/docs/gated-collection-bootstrap");
		expect(gitignore).toContain(".generated/");
		expect(gitignore).toContain("public/_docs/");
		expect(gitignore).toContain("public/_gated-docs/");
		expect(gitignore).toContain("public/pagefind/");
	});

	it("uses campus docs theme styles for reader metadata, versions, and source highlights", () => {
		const themeSource = readFileSync(join(appDir, "theme", "index.tsx"), "utf8");
		const cssSource = readFileSync(join(appDir, "theme", "docs-ui.css"), "utf8");

		expect(themeSource).toContain("Layout as OriginalLayout");
		expect(themeSource).toContain("resolveReaderLayoutClasses");
		expect(cssSource).toContain(".document-meta-panel");
		expect(cssSource).toContain(".docs-version-switcher");
		expect(cssSource).toContain(".reader-block.docs-reader-highlight");
		expect(cssSource).toContain("var(--sys-brand-interactive,");
		expect(cssSource).toContain("var(--docs-identity,");
		expect(cssSource).not.toContain("公开文档");
	});
});
