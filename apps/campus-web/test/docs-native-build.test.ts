import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	resolveCollectionLabel,
	resolveDocumentDisplayTitle,
	resolveReaderLayout,
	resolveReaderMeasure,
} from "../src/docs-reader-build/published-reader-labels.ts";

const appRoot = join(__dirname, "..");

describe("native docs build boundary", () => {
	it("uses readable Chinese document display titles without changing source identity", () => {
		expect(resolveDocumentDisplayTitle("中央民族大学本科(预科)学生证管理办法")).toBe(
			"本科（预科）学生证管理办法",
		);
		expect(resolveDocumentDisplayTitle("中央民族大学第七节 | 14:50-15:35")).toBe(
			"第七节 | 14:50-15:35",
		);
	});

	it("keeps the three curriculum collections on the tabular reader surface", () => {
		for (const [collection, label] of [
			["undergraduate", "本科培养方案"],
			["second_degree", "二学位培养方案"],
			["general_education", "通识教育"],
		] as const) {
			const entry = { collection, corpus: "curriculum" } as const;
			expect(resolveCollectionLabel(entry)).toBe(label);
			expect(resolveReaderLayout(entry)).toBe("tabular");
			expect(resolveReaderMeasure(entry)).toBe("wide");
		}
		expect(resolveCollectionLabel({ collection: "undergraduate", corpus: "regulations" })).toBe(
			"undergraduate",
		);
	});

	it("uses the Campus Web router and keeps the document entry isolated from the app entry", () => {
		const mainSource = readFileSync(join(appRoot, "src/main.tsx"), "utf8");
		const docsMainSource = readFileSync(join(appRoot, "src/docs-main.tsx"), "utf8");
		const docsPrerenderSource = readFileSync(
			join(appRoot, "src/docs-reader-build/native-reader-prerender.tsx"),
			"utf8",
		);
		const indexHtmlSource = readFileSync(join(appRoot, "index.html"), "utf8");

		expect(mainSource).not.toContain("docs-router");
		expect(docsMainSource).toContain("createDocsRouter");
		expect(docsPrerenderSource).toContain('<link rel="stylesheet" href="/src/styles.css" />');
		expect(docsPrerenderSource).toContain(
			'<link rel="stylesheet" href="/src/components/docs/docs-reader.css" />',
		);
		expect(docsPrerenderSource).toContain('<script src="/theme-bootstrap.js"></script>');
		expect(docsPrerenderSource).toContain("renderMetadata: false");
		expect(docsPrerenderSource).toMatch(/<title>\$\{escapeHtml\(metadata\.title\)}<\/title>/);
		expect(docsPrerenderSource).not.toMatch(
			/<title>\$\{escapeHtml\(metadata\.title\)} \| 中央民族大学校园问答<\/title>/,
		);
		expect(indexHtmlSource).toContain('<script src="/theme-bootstrap.js"></script>');
		expect(docsMainSource).not.toContain("getCampusRuntimeConfig");
		expect(docsMainSource).not.toContain("initializeCampusBrowserSentry");
	});

	it("declares the current document asset and build inputs", () => {
		const wrangler = readFileSync(join(appRoot, "wrangler.toml"), "utf8");
		const turbo = readFileSync(join(appRoot, "turbo.json"), "utf8");

		expect(wrangler).toContain('html_handling = "drop-trailing-slash"');
		expect(wrangler).toContain('not_found_handling = "404-page"');
		expect(wrangler).toContain('"!/docs/*"');
		expect(turbo).toContain('".generated/docs-content/sources/**"');
	});
});
