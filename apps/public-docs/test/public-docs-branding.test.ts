import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ensurePublicDocsScaffold } from "../scripts/ensure-docs-scaffold";

const testDir = dirname(fileURLToPath(import.meta.url));
const appRoot = join(testDir, "..");
const canonicalFaviconPath = join(appRoot, "../../configs/branding/web-public/favicon.ico");

describe("public docs branding assets", () => {
	it("pins the shared MUC Wiki favicon in config and scaffold output", () => {
		const rspressConfig = readFileSync(join(appRoot, "rspress.config.ts"), "utf-8");
		const canonicalFavicon = readFileSync(canonicalFaviconPath);
		const trackedDocsFavicon = readFileSync(join(appRoot, "docs/public/favicon.ico"));

		expect(rspressConfig).toContain('icon: "/favicon.ico"');
		expect(trackedDocsFavicon.equals(canonicalFavicon)).toBe(true);

		const root = mkdtempSync(join(tmpdir(), "public-docs-branding-"));
		try {
			const docsRoot = join(root, "apps/public-docs/docs");
			ensurePublicDocsScaffold({ docsRoot });
			const scaffoldedFavicon = readFileSync(join(docsRoot, "public/favicon.ico"));
			expect(scaffoldedFavicon.equals(canonicalFavicon)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
