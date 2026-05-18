import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import indexHtmlSource from "../index.html?raw";
import viteConfigSource from "../vite.config.ts?raw";

const canonicalFaviconPath = fileURLToPath(
	new URL("../../../configs/branding/web-public/favicon.ico", import.meta.url),
);

describe("protected panel branding assets", () => {
	it("pins the shared MUC Wiki favicon in the shell and shared public asset root", () => {
		expect(indexHtmlSource).toContain('href="/favicon.ico"');
		expect(viteConfigSource).toContain("configs/branding/web-public");
		expect(existsSync(canonicalFaviconPath)).toBe(true);
	});
});
