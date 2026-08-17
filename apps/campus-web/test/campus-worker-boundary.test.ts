// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const appRoot = join(import.meta.dirname, "..");

function read(relativePath: string): string {
	return readFileSync(join(appRoot, relativePath), "utf8");
}

describe("campus worker module boundary", () => {
	it("keeps the public worker entry focused on composition", () => {
		const source = read("src/index.ts");

		expect(source).toContain("Sentry.withSentry");
		expect(source).toContain('from "./platform/worker/router"');
		expect(source).not.toContain("async fetch(");
		expect(source).not.toContain("SHELL_EXACT_PATHS");
		expect(source).not.toContain("proxyCacheableAppApiRequest");
	});

	it("prevents worker internals from importing the public entry", () => {
		for (const relativePath of [
			"src/platform/telemetry/sentry-edge.ts",
			"src/platform/worker/app-api-proxy.ts",
			"src/platform/worker/assets.ts",
			"src/platform/worker/router.ts",
			"src/platform/worker/shell.ts",
		]) {
			const source = read(relativePath);
			expect(source, relativePath).not.toMatch(/from ["'](?:\.\.\/)+index["']/u);
		}
	});

	it("keeps routing, asset delivery, shell rendering, and API proxy ownership separate", () => {
		const router = read("src/platform/worker/router.ts");
		const assets = read("src/platform/worker/assets.ts");
		const shell = read("src/platform/worker/shell.ts");

		expect(router).toContain('from "./app-api-proxy"');
		expect(router).toContain('from "./assets"');
		expect(router).toContain('from "./shell"');
		expect(assets).not.toContain("resolveTurnstileRuntimeConfig");
		expect(shell).not.toContain("isAllowedCampusAppApiRequest");
	});
});
