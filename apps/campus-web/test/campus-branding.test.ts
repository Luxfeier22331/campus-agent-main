import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import indexHtmlSource from "../index.html?raw";
import viteConfigSource from "../vite.config.ts?raw";

const canonicalFaviconPath = join(__dirname, "../assets/favicon.ico");

describe("Campus web branding assets", () => {
	it("pins the MUC Wiki favicon in the shell and build pipeline", () => {
		expect(indexHtmlSource).toContain('href="/favicon.ico"');
		expect(indexHtmlSource).toContain('<meta name="color-scheme" content="light dark" />');
		expect(indexHtmlSource).toContain('<script src="/theme-bootstrap.js"></script>');
		expect(indexHtmlSource).toContain('data-app-boot role="status"');
		expect(indexHtmlSource).toContain('aria-label="正在加载页面"');
		expect(viteConfigSource).toContain("const campusWebRoot = import.meta.dirname");
		expect(viteConfigSource).toContain('path.resolve(campusWebRoot, "assets/favicon.ico")');
		expect(viteConfigSource).toContain('dedupe: ["react", "react-dom"]');
		expect(existsSync(canonicalFaviconPath)).toBe(true);
	});
});
