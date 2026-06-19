import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import indexHtmlSource from "../index.html?raw";
import viteConfigSource from "../vite.config.ts?raw";

const canonicalFaviconPath = join(__dirname, "../../../configs/branding/web-public/favicon.ico");

describe("Campus web branding assets", () => {
	it("pins the shared MUC Wiki favicon in the shell and build pipeline", () => {
		expect(indexHtmlSource).toContain('href="/favicon.ico"');
		expect(viteConfigSource).toContain("configs/branding/web-public/favicon.ico");
		expect(existsSync(canonicalFaviconPath)).toBe(true);
	});
});
