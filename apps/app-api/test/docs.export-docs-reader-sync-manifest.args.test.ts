// @vitest-environment node

import { describe, expect, it } from "vitest";

import { resolveDocsReaderSyncManifestOutputPath } from "../ops/docs-reader/export-docs-reader-sync-manifest";

describe("docs reader sync manifest export args", () => {
	it("ignores pnpm argument separator when resolving output path", () => {
		expect(resolveDocsReaderSyncManifestOutputPath(["--", "../../var/public.json"], {})).toBe(
			"../../var/public.json",
		);
	});

	it("uses env output path when positional path is absent", () => {
		expect(
			resolveDocsReaderSyncManifestOutputPath([], {
				DOCS_READER_SYNC_MANIFEST_PATH: "/tmp/docs-reader.json",
			}),
		).toBe("/tmp/docs-reader.json");
	});

	it("fails closed on multiple output path arguments", () => {
		expect(() => resolveDocsReaderSyncManifestOutputPath(["a.json", "b.json"], {})).toThrow(
			"expected at most one docs reader sync manifest path",
		);
	});
});
