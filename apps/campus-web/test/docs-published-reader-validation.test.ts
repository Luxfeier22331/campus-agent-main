import { afterEach, describe, expect, it } from "vitest";

import { compileDocsSource } from "../src/docs-reader-build/source-compiler.ts";
import {
	cleanupPublishedReaderFixture,
	createPublishedReaderFixture,
} from "./helpers/published-reader-fixture";

afterEach(cleanupPublishedReaderFixture);

describe("campus-web published reader validation", () => {
	it("rejects reader bytes that do not match their object reference", async () => {
		const { client, source } = createPublishedReaderFixture();
		const entry = source.versions[0];
		if (!entry) {
			throw new Error("published reader fixture is incomplete");
		}
		entry.reader.sha256 = `sha256:${"0".repeat(64)}`;

		await expect(compileDocsSource({ client, source })).rejects.toThrow(
			"published reader object failed integrity check: reader/public.json",
		);
	});

	it("rejects a reader whose document identity differs from the docs entry", async () => {
		const { client, source } = createPublishedReaderFixture({
			publicReaderDocId: "another-document",
		});

		await expect(compileDocsSource({ client, source })).rejects.toThrow(
			"reader identity does not match docs version: version_public",
		);
	});

	it("rejects a reader whose version identity differs from the docs entry", async () => {
		const { client, source } = createPublishedReaderFixture({
			publicReaderVersionId: "another-version",
		});

		await expect(compileDocsSource({ client, source })).rejects.toThrow(
			"reader identity does not match docs version: version_public",
		);
	});

	it("rejects reader supplements that differ from the docs entry", async () => {
		const { client, source } = createPublishedReaderFixture({
			omitPublicReaderSupplement: true,
		});

		await expect(compileDocsSource({ client, source })).rejects.toThrow(
			"reader supplements do not match docs version: version_public",
		);
	});
});
