// @vitest-environment node

import { describe, expect, it } from "vitest";

import { resolvePublicDocsSyncManifestOutputPath } from "../scripts/export-public-docs-sync-manifest";

describe("public docs sync manifest export args", () => {
	it("ignores pnpm argument separator when resolving output path", () => {
		expect(resolvePublicDocsSyncManifestOutputPath(["--", "../../var/public.json"], {})).toBe(
			"../../var/public.json",
		);
	});

	it("uses env output path when positional path is absent", () => {
		expect(
			resolvePublicDocsSyncManifestOutputPath([], {
				PUBLIC_DOCS_SYNC_MANIFEST_PATH: "/tmp/public-docs.json",
			}),
		).toBe("/tmp/public-docs.json");
	});

	it("fails closed on multiple output path arguments", () => {
		expect(() => resolvePublicDocsSyncManifestOutputPath(["a.json", "b.json"], {})).toThrow(
			"expected at most one public docs sync manifest path",
		);
	});
});
