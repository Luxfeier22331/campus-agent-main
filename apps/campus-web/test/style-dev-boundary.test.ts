// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isCampusShellPath } from "../src/platform/worker/shell.ts";

const appRoot = join(import.meta.dirname, "..");

function read(relativePath: string): string {
	return readFileSync(join(appRoot, relativePath), "utf8");
}

describe("Campus Web 本地样式页边界", () => {
	it("只作为 Vite 开发入口存在，不进入产品 shell 路由", () => {
		expect(read("style-dev.html")).toContain("/src/style-dev/main.tsx");
		expect(read("vite.config.ts")).toContain('path.resolve(campusWebRoot, "index.html")');
		expect(isCampusShellPath("/style-dev.html")).toBe(false);
		expect(read("src/platform/worker/router.ts")).not.toContain("style-dev.html");
	});

	it("只直接组合组件和最小本地容器", () => {
		const sourceRoot = join(appRoot, "src/style-dev");
		const source = [
			"catalog.tsx",
			"providers.tsx",
			"examples/account.tsx",
			"examples/conversation.tsx",
			"examples/dining.tsx",
			"examples/docs.tsx",
			"examples/forms.tsx",
			"examples/foundations.tsx",
			"examples/map.tsx",
			"examples/overlays.tsx",
		]
			.map((path) => readFileSync(join(sourceRoot, path), "utf8"))
			.join("\n");

		expect(source).not.toMatch(/@\/app\/routes\//u);
		expect(source).not.toMatch(/@\/features\/[\w-]+\/api/u);
		expect(source).not.toMatch(/@\/platform\/auth\/client/u);
		expect(source).not.toMatch(/\bfetch\s*\(/u);
		expect(source).not.toMatch(/collapsible="none"/u);
		expect(source).not.toContain("CampusChatWorkspace");
		expect(source).not.toContain("CampusTopNav");
		expect(source).not.toContain("DocsShell");
		expect(source).not.toContain("DocsRouterProvider");
		expect(source).not.toContain("MapPage");
		expect(source).not.toContain("MapProductExperience");
		expect(source).toContain("ThreadListSidebar");
		expect(source).toContain("SidebarTrigger");
		expect(source).toContain("DocsPage");
		expect(source).toContain("MapExperience");
		expect(source).not.toMatch(
			/style-dev-real-sidebar|style-dev-example-grid|style-dev-example-block/u,
		);
		expect(read("src/components/map/map-experience.tsx")).not.toContain("CampusTopNav");
		expect(read("src/components/map/map-product-experience.tsx")).toContain("CampusTopNav");
		expect(existsSync(join(sourceRoot, "harness.tsx"))).toBe(false);
		expect(existsSync(join(sourceRoot, "product-previews.tsx"))).toBe(false);
		expect(existsSync(join(sourceRoot, "fixtures.ts"))).toBe(false);
	});

	it("不维护 style-dev 专用 Playwright lane", () => {
		expect(existsSync(join(appRoot, "e2e/style-dev.spec.ts"))).toBe(false);
		expect(existsSync(join(appRoot, "e2e.style-dev.config.ts"))).toBe(false);
		expect(read("package.json")).not.toContain("test:e2e:style-dev");
		expect(read("../../turbo.json")).not.toContain("test:e2e:style-dev");
	});

	it("已存在构建制品时不包含样式页 HTML 或样式页模块图", () => {
		const clientRoot = join(appRoot, "dist/client");
		const graphPath = join(appRoot, ".generated/bundle-graph.json");
		if (!(existsSync(clientRoot) && existsSync(graphPath))) {
			return;
		}

		expect(existsSync(join(clientRoot, "style-dev.html"))).toBe(false);
		expect(readFileSync(graphPath, "utf8")).not.toContain("/src/style-dev/");
	});
});
