import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	resolveCollectionLabel,
	resolveDocumentDisplayTitle,
	resolveReaderLayout,
	resolveReaderMeasure,
} from "../src/docs-reader-build/published-reader-labels.ts";

const appRoot = join(__dirname, "..");

describe("native docs build boundary", () => {
	it("uses readable Chinese document display titles without changing source identity", () => {
		expect(resolveDocumentDisplayTitle("中央民族大学本科(预科)学生证管理办法")).toBe(
			"本科（预科）学生证管理办法",
		);
		expect(resolveDocumentDisplayTitle("中央民族大学第七节 | 14:50-15:35")).toBe(
			"第七节 | 14:50-15:35",
		);
	});

	it("keeps the three curriculum collections on the tabular reader surface", () => {
		for (const [collection, label] of [
			["undergraduate", "本科培养方案"],
			["second_degree", "二学位培养方案"],
			["general_education", "通识教育"],
		] as const) {
			const entry = { collection, corpus: "curriculum" } as const;
			expect(resolveCollectionLabel(entry)).toBe(label);
			expect(resolveReaderLayout(entry)).toBe("tabular");
			expect(resolveReaderMeasure(entry)).toBe("wide");
		}
		expect(resolveCollectionLabel({ collection: "undergraduate", corpus: "regulations" })).toBe(
			"undergraduate",
		);
	});

	it("uses the Campus Web router and keeps the document entry isolated from the app entry", () => {
		const packageJson = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as {
			dependencies: Record<string, string>;
			scripts: Record<string, string>;
		};
		const mainSource = readFileSync(join(appRoot, "src/main.tsx"), "utf8");
		const docsMainSource = readFileSync(join(appRoot, "src/docs-main.tsx"), "utf8");
		const docsReaderSource = readFileSync(
			join(appRoot, "src/components/docs/docs-reader-view.tsx"),
			"utf8",
		);
		const docsReaderStyles = readFileSync(
			join(appRoot, "src/components/docs/docs-reader.css"),
			"utf8",
		);
		const docsPrerenderSource = readFileSync(
			join(appRoot, "src/docs-reader-build/native-reader-prerender.tsx"),
			"utf8",
		);
		const docsPreparationSource = readFileSync(
			join(appRoot, "scripts/prepare-docs-content.ts"),
			"utf8",
		);
		const indexHtmlSource = readFileSync(join(appRoot, "index.html"), "utf8");
		const viteSource = readFileSync(join(appRoot, "vite.config.ts"), "utf8");

		expect(packageJson.dependencies.flexsearch).toBe("0.8.212");
		expect(packageJson.dependencies).not.toHaveProperty("@rspress/core");
		expect(packageJson.scripts.build).toBe("pnpm exec tsx ./scripts/build-campus-web.ts");
		expect(packageJson.scripts["build:test"]).toBe(
			"pnpm exec tsx ./test/build-browser-test-content.ts",
		);
		expect(packageJson.scripts["build:worker"]).toBe("CLOUDFLARE_ENV=local pnpm run build:test");
		expect(packageJson.scripts["docs:prepare"]).toBe(
			"pnpm exec tsx ./scripts/prepare-docs-content.ts",
		);
		expect(packageJson.scripts["docs:source:update"]).toBe(
			"pnpm exec tsx ./scripts/update-docs-source.ts",
		);
		expect(packageJson.scripts["docs:source:clean-segmentation"]).toBe(
			"pnpm exec tsx ./scripts/hotfix-docs-reader-segmentation.ts",
		);
		expect(packageJson.scripts).not.toHaveProperty(["docs", "source", "publish"].join(":"));
		expect(mainSource).not.toContain("docs-reader.css");
		expect(mainSource).not.toContain("docs-router");
		expect(docsMainSource).not.toContain("docs-reader.css");
		expect(docsMainSource).toContain("createDocsRouter");
		expect(docsPrerenderSource).toContain('<link rel="stylesheet" href="/src/styles.css" />');
		expect(docsPrerenderSource).toContain(
			'<link rel="stylesheet" href="/src/components/docs/docs-reader.css" />',
		);
		expect(docsPrerenderSource).toContain('<script src="/theme-bootstrap.js"></script>');
		expect(docsPreparationSource).toContain("THEME_BOOTSTRAP_SOURCE");
		expect(indexHtmlSource).toContain('<script src="/theme-bootstrap.js"></script>');
		expect(viteSource).toContain("environments:");
		expect(viteSource).toContain("resolveDocsBuildContent()");
		expect(viteSource).toContain("isPreview ? undefined : resolveDocsBuildContent()");
		expect(viteSource).toContain("publicDir: docsContent?.paths.publicRoot ?? false");
		expect(viteSource).toContain('buildTarget === "docs" && command !== "build"');
		expect(viteSource).toContain('buildTarget === "app" && command === "serve"');
		expect(viteSource).toContain("htmlInputs = findHtmlInputs(docsContent.paths.pagesRoot)");
		expect(viteSource).toContain("relocateDocsHtmlPages({");
		expect(viteSource).toContain("CAMPUS_WEB_BUILD_TARGET must be app or docs.");
		expect(viteSource).toContain("serveDocsDevelopmentShell(docsContent.paths.publicRoot)");
		expect(docsMainSource).not.toContain("getCampusRuntimeConfig");
		expect(docsMainSource).not.toContain("initializeCampusBrowserSentry");
		expect(docsReaderSource).toContain('className="docs-reader-list" role="list"');
		expect(docsReaderStyles).toMatch(/\.docs-reader-list\s*\{[^}]*list-style:\s*none;/u);
		expect(viteSource).not.toContain("injectDocsDevelopmentRuntimeConfig");
		expect(viteSource).not.toContain("CAMPUS_RUNTIME_CONFIG_SCRIPT_ID");
		expect(viteSource).toContain('environment.name === "client"');
	});

	it("has no Rspress config, theme, or static namespace left in the package", () => {
		expect(existsSync(join(appRoot, "rspress.config.ts"))).toBe(false);
		expect(existsSync(join(appRoot, "theme/index.tsx"))).toBe(false);
		expect(existsSync(join(appRoot, "theme/docs-ui.css"))).toBe(false);
		expect(existsSync(join(appRoot, "src/types/rspress-virtual.d.ts"))).toBe(false);
		const wrangler = readFileSync(join(appRoot, "wrangler.toml"), "utf8");
		const turbo = readFileSync(join(appRoot, "turbo.json"), "utf8");
		expect(wrangler).not.toContain("_docs-static");
		expect(wrangler).toContain('html_handling = "drop-trailing-slash"');
		expect(wrangler).toContain('not_found_handling = "404-page"');
		expect(wrangler).toContain('"!/docs/*"');
		expect(turbo).not.toContain("_docs-static");
		expect(turbo).toContain('".generated/docs-content/sources/**"');
		expect(turbo).not.toContain('".generated/docs-native/**"');
		expect(turbo).not.toContain('"docs/**"');
	});
});
