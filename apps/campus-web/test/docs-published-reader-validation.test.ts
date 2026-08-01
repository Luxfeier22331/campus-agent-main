import { afterEach, describe, expect, it } from "vitest";

import { checkCampusPublishedReaderInputs } from "../src/docs-reader-build/sync-campus-published-reader.ts";
import {
	cleanupPublishedReaderFixture,
	createPublishedReaderFixture,
} from "./helpers/published-reader-fixture";

afterEach(cleanupPublishedReaderFixture);

describe("campus-web published reader validation", () => {
	it("rejects reader bytes that do not match their object reference", async () => {
		const { client, manifest } = createPublishedReaderFixture();
		const entry = manifest.entries[0];
		if (!entry) {
			throw new Error("published reader fixture is incomplete");
		}
		entry.reader.sha256 = `sha256:${"0".repeat(64)}`;

		await expect(checkCampusPublishedReaderInputs({ client, manifest })).rejects.toThrow(
			"published reader object failed integrity check: reader/public.json",
		);
	});

	it("rejects a reader whose document identity differs from the docs entry", async () => {
		const { client, manifest } = createPublishedReaderFixture({
			publicReaderDocId: "another-document",
		});

		await expect(checkCampusPublishedReaderInputs({ client, manifest })).rejects.toThrow(
			"published reader identity does not match docs entry: version_public",
		);
	});

	it("rejects a reader whose version identity differs from the docs entry", async () => {
		const { client, manifest } = createPublishedReaderFixture({
			publicReaderVersionId: "another-version",
		});

		await expect(checkCampusPublishedReaderInputs({ client, manifest })).rejects.toThrow(
			"published reader identity does not match docs entry: version_public",
		);
	});

	it("rejects reader supplements that differ from the docs entry", async () => {
		const { client, manifest } = createPublishedReaderFixture({
			omitPublicReaderSupplement: true,
		});

		await expect(checkCampusPublishedReaderInputs({ client, manifest })).rejects.toThrow(
			"published reader supplements do not match docs entry: version_public",
		);
	});
});
