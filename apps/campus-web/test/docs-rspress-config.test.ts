import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = join(__dirname, "..");

describe("campus docs Rspress build boundary", () => {
	it("declares Rspress as the campus docs reader engine", () => {
		const packageJson = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as {
			dependencies: Record<string, string>;
			scripts: Record<string, string>;
		};
		const configSource = readFileSync(join(appDir, "rspress.config.ts"), "utf8");

		expect(packageJson.dependencies["@rspress/core"]).toBeTruthy();
		expect(packageJson.scripts["docs:build"]).toContain("rspress build");
		expect(packageJson.scripts.build).toContain("pnpm docs:build");
		expect(packageJson.scripts["build:staging"]).toContain("pnpm docs:build");
		expect(configSource).toContain('logoText: "中央民族大学校园问答"');
		expect(configSource).toContain("reader-state-enhancer");
	});

	it("copies only docs route assets into campus-web static delivery", () => {
		const copyScript = readFileSync(join(appDir, "scripts", "copy-rspress-docs-build.mjs"), "utf8");

		expect(copyScript).toContain('for (const routeRoot of ["docs", "static"])');
		expect(copyScript).not.toContain('"index.html"');
		expect(copyScript).not.toContain("__campus_docs");
	});
});
