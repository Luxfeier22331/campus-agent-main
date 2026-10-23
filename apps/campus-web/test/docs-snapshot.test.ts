import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOCS_SOURCE_KEY, normalizeSourceManifest } from "campus-contracts/campus-docs/node";
import { afterEach, assert, expect, it } from "vitest";
import { prepareDocsContent } from "../scripts/prepare-docs-content.ts";
import { canonicalJsonBytes } from "../src/docs-reader-build/artifact-digest.ts";
import { recordingSnapshotReader, snapshotReader } from "../src/docs-reader-build/docs-snapshot.ts";
import {
	cleanupPublishedReaderFixture,
	createPublishedReaderFixture,
} from "./helpers/published-reader-fixture.ts";

afterEach(cleanupPublishedReaderFixture);
it("records the complete reader closure and rebuilds it offline", async () => {
	const fixture = createPublishedReaderFixture();
	const root = await mkdtemp(join(tmpdir(), "docs-snapshot-test-"));
	try {
		const client = await recordingSnapshotReader(join(root, "snapshot"), {
			readOptionalBytesObject: ({ key }) =>
				key === DOCS_SOURCE_KEY
					? Promise.resolve(canonicalJsonBytes(normalizeSourceManifest(fixture.source)))
					: fixture.client.readOptionalBytesObject({ key }),
		});
		const recorded = await prepareDocsContent({
			appRoot: join(root, "recorded"),
			client,
			pages: false,
			refresh: true,
		});
		const offline = await prepareDocsContent({
			appRoot: join(root, "offline"),
			client: snapshotReader(join(root, "snapshot")),
			pages: false,
			refresh: true,
		});
		expect(offline.root.split("/").at(-1)).toEqual(recorded.root.split("/").at(-1));
		await expect(
			prepareDocsContent({
				appRoot: join(root, "missing"),
				client: snapshotReader(join(root, "empty")),
				pages: false,
				refresh: true,
			}),
		).rejects.toThrow();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
it("fixes each object read while recording mutable upstream objects", async () => {
	const root = await mkdtemp(join(tmpdir(), "docs-snapshot-read-"));
	let calls = 0;
	try {
		const reader = await recordingSnapshotReader(root, {
			readOptionalBytesObject: async () => new TextEncoder().encode(String(++calls)),
		});
		const [first, second] = await Promise.all([
			reader.readOptionalBytesObject({ key: "catalog" }),
			reader.readOptionalBytesObject({ key: "catalog" }),
		]);
		assert(first);
		expect(first).toEqual(second);
		expect(calls).toBe(1);
		expect(await snapshotReader(root).readOptionalBytesObject({ key: "catalog" })).toEqual(
			Buffer.from(first),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
