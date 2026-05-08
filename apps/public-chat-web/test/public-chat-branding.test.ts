import { describe, expect, it } from "vitest";

import indexHtmlSource from "../index.html?raw";
import viteConfigSource from "../vite.config.ts?raw";

describe("public chat branding assets", () => {
	it("pins the shared MUC Wiki favicon in the shell and shared public asset root", () => {
		expect(indexHtmlSource).toContain('href="/favicon.ico"');
		expect(viteConfigSource).toContain("configs/branding/web-public");
	});
});
