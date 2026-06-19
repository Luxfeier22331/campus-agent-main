import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const vendorRoot = path.resolve("public/vendor/openai-chatkit/2026-06-17");
const manifestPath = path.join(vendorRoot, "manifest.json");

interface ChatKitVendorManifest {
	files: Array<{
		bytes: number;
		path: string;
		sha256: string;
	}>;
	version: string;
}

describe("self-hosted ChatKit runtime vendor manifest", () => {
	it("covers the runtime script, iframe HTML, and referenced assets", () => {
		expect(existsSync(manifestPath)).toBe(true);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ChatKitVendorManifest;
		const manifestPaths = new Set(manifest.files.map((file) => file.path));

		expect(manifest.version).toBe("2026-06-17");
		expect(manifestPaths.has("chatkit.js")).toBe(true);
		expect(
			[...manifestPaths].some((filePath) => /^index-[A-Za-z0-9_-]+\.html$/.test(filePath)),
		).toBe(true);
		expect(manifestPaths.has("assets/ck1/index-D1Pi4YsE.js")).toBe(true);
		expect(manifestPaths.has("assets/ck1/index-D9b2ZX6j.css")).toBe(true);
		expect(manifestPaths.has("assets/ck1/index-PBqDrfdS.js")).toBe(true);
		expect(manifestPaths.has("assets/ck1/zh-CN-CvLn89AG.js")).toBe(true);

		for (const entry of manifest.files) {
			const filePath = path.join(vendorRoot, entry.path);
			expect(existsSync(filePath), entry.path).toBe(true);
			const bytes = readFileSync(filePath);
			expect(bytes.byteLength, entry.path).toBe(entry.bytes);
			expect(createHash("sha256").update(bytes).digest("hex"), entry.path).toBe(entry.sha256);
		}
	});

	it("keeps the vendored runtime self-contained for browser loading", () => {
		const runtimeText = readFileSync(path.join(vendorRoot, "chatkit.js"), "utf8");
		const frameHtml = readFileSync(path.join(vendorRoot, "index-eyaQ-7_lsQ.html"), "utf8");

		expect(runtimeText).not.toContain("sourceMappingURL=");
		expect(frameHtml).toContain('src="assets/ck1/index-D1Pi4YsE.js"');
		expect(frameHtml).toContain('href="assets/ck1/index-D9b2ZX6j.css"');
		expect(frameHtml).not.toContain("cdn.platform.openai.com");
		expect(frameHtml).not.toContain("/assets/ck1/");
		expect(frameHtml).not.toContain("/cdn-cgi/");
	});
});
