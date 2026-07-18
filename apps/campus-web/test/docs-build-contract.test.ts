import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	assertManifestBytesSha256,
	assertManifestSha256,
	parseBuildPublishedReaderDocsArgs,
} from "../scripts/build-published-reader-docs";
import { parseReleaseBuildArgs } from "../scripts/build-release";
import { verifyPublishedReaderRelease } from "../scripts/verify-published-reader-release";

let fixtureRoot: string | null = null;

afterEach(() => {
	if (fixtureRoot) {
		rmSync(fixtureRoot, { force: true, recursive: true });
		fixtureRoot = null;
	}
});

describe("campus docs build contract", () => {
	it("keeps fixture builds credential-free and release builds explicit", () => {
		expect(parseBuildPublishedReaderDocsArgs(["--fixture"])).toEqual({ fixture: true });
		expect(() => parseBuildPublishedReaderDocsArgs([])).toThrow("docs release id must be");
	});

	it("rejects a release manifest whose digest changed", () => {
		fixtureRoot = mkdtempSync(join(tmpdir(), "campus-docs-build-"));
		const manifestPath = join(fixtureRoot, "manifest.json");
		writeFileSync(manifestPath, '{"surface":"campus_docs"}');
		const digest = createHash("sha256").update('{"surface":"campus_docs"}').digest("hex");

		expect(() => assertManifestSha256(manifestPath, digest)).not.toThrow();
		expect(() => assertManifestSha256(manifestPath, "0".repeat(64))).toThrow("SHA-256 mismatch");
		expect(() =>
			assertManifestBytesSha256(new TextEncoder().encode('{"surface":"campus_docs"}'), digest),
		).not.toThrow();
	});

	it("verifies the selected release through the object-store client", async () => {
		const bytes = new TextEncoder().encode('{"surface":"campus_docs"}');
		const digest = createHash("sha256").update(bytes).digest("hex");
		const releaseId = `sha256:${digest}`;
		await expect(
			verifyPublishedReaderRelease(releaseId, {
				readOptionalBytesObject: async () => bytes,
				readTextObject: async () => "",
			}),
		).resolves.toBeUndefined();
		await expect(
			verifyPublishedReaderRelease(releaseId, {
				readOptionalBytesObject: async () => undefined,
				readTextObject: async () => "",
			}),
		).rejects.toThrow("missing docs reader release manifest object");
	});

	it("accepts one content-addressed release id and rejects legacy selectors", () => {
		const digest = "a".repeat(64);
		const releaseId = `sha256:${digest}`;
		expect(parseReleaseBuildArgs(["--release-id", releaseId])).toEqual({
			releaseId,
			staging: false,
		});
		expect(parseReleaseBuildArgs(["--staging", "--release-id", releaseId])).toEqual({
			releaseId,
			staging: true,
		});
		expect(parseBuildPublishedReaderDocsArgs(["--release-id", releaseId])).toEqual({
			fixture: false,
			releaseId,
		});
		expect(() => parseReleaseBuildArgs([])).toThrow("docs release id must be");
		expect(() =>
			parseBuildPublishedReaderDocsArgs(["--release-id", `sha256:${"A".repeat(64)}`]),
		).toThrow("docs release id must be");
		expect(() => parseReleaseBuildArgs(["--manifest-key", "legacy.json"])).toThrow(
			"unknown release build argument",
		);
	});
});
