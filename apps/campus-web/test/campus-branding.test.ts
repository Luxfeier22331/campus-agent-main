import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import indexHtmlSource from "../index.html?raw";
import viteConfigSource from "../vite.config.ts?raw";

const canonicalFaviconPath = join(__dirname, "../../../configs/branding/web-public/favicon.ico");

describe("Campus web branding assets", () => {
	it("pins the shared MUC Wiki favicon in the shell and build pipeline", () => {
		expect(indexHtmlSource).toContain('href="/favicon.ico"');
		expect(indexHtmlSource).toContain('<meta name="color-scheme" content="light dark" />');
		expect(indexHtmlSource).toContain('<script src="/theme-bootstrap.js"></script>');
		expect(indexHtmlSource).toContain('data-app-boot role="status"');
		expect(indexHtmlSource).toContain('aria-label="正在加载页面"');
		expect(viteConfigSource).toContain("configs/branding/web-public/favicon.ico");
		expect(viteConfigSource).toContain('dedupe: ["react", "react-dom"]');
		expect(existsSync(canonicalFaviconPath)).toBe(true);
	});
});
