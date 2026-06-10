import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = join(__dirname, "..");

describe("campus docs Rspress build boundary", () => {
	it("builds published reader docs for product builds instead of scaffold placeholders", () => {
		const packageJson = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as {
			dependencies: Record<string, string>;
			scripts: Record<string, string>;
		};
		const configSource = readFileSync(join(appDir, "rspress.config.ts"), "utf8");

		expect(packageJson.dependencies["@rspress/core"]).toBeTruthy();
		expect(packageJson.scripts["docs:build:scaffold"]).toContain("docs:scaffold");
		expect(packageJson.scripts["docs:build:published-reader"]).toContain(
			"docs:sync:published-reader",
		);
		expect(packageJson.scripts["docs:build:published-reader"]).toContain("rspress build");
		expect(packageJson.scripts.build).toContain("pnpm docs:build:published-reader");
		expect(packageJson.scripts["build:staging"]).toContain("pnpm docs:build:published-reader");
		expect(packageJson.scripts.build).not.toContain("docs:scaffold");
		expect(packageJson.scripts["build:staging"]).not.toContain("docs:scaffold");
		expect(configSource).toContain('logoText: "中央民族大学校园问答"');
		expect(configSource).toContain("docs-search-hook");
		expect(configSource).toContain("buildRspressSidebarConfig");
		expect(configSource).toContain("reader-state-enhancer");
		expect(configSource).toContain("docs-content-enhancer");
		expect(configSource).toContain("mobile-sidebar-guard");
		expect(configSource).toContain("search-keyboard-guard");
	});

	it("copies only docs route assets into campus-web static delivery", () => {
		const copyScript = readFileSync(join(appDir, "scripts", "copy-rspress-docs-build.mjs"), "utf8");

		expect(copyScript).toContain('for (const routeRoot of ["docs", "static"])');
		expect(copyScript).not.toContain('"index.html"');
		expect(copyScript).not.toContain("__campus_docs");
	});

	it("uses campus docs theme styles for reader metadata, versions, and source highlights", () => {
		const themeSource = readFileSync(join(appDir, "theme", "index.tsx"), "utf8");
		const cssSource = readFileSync(join(appDir, "theme", "docs-ui.css"), "utf8");

		expect(themeSource).toContain("Layout as OriginalLayout");
		expect(themeSource).toContain("resolveReaderLayoutClasses");
		expect(cssSource).toContain(".document-meta-panel");
		expect(cssSource).toContain(".docs-version-switcher");
		expect(cssSource).toContain(".reader-block.docs-reader-highlight");
		expect(cssSource).toContain("var(--sys-brand-interactive)");
		expect(cssSource).not.toContain("公开文档");
	});
});
