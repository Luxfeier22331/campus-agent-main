import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	syncGatedReaderAssetsToBucket,
	type WritableObjectStoreClient,
} from "../scripts/sync-gated-reader-assets-to-r2";
import { FakeObjectStore, temporaryDirectories } from "./sync-real-docs-test-support";

function writeManifest(value: unknown): string {
	const directory = mkdtempSync(join(tmpdir(), "gated-reader-assets-"));
	temporaryDirectories.push(directory);
	const path = join(directory, "docs-read-model-manifest.json");
	writeFileSync(path, JSON.stringify(value), "utf8");
	return path;
}

class FakeWritableObjectStore implements WritableObjectStoreClient {
	readonly writes = new Map<
		string,
		{
			bucket?: string;
			bytes: Uint8Array;
			contentType: string;
		}
	>();

	async writeBytesObject(input: {
		bucket?: string;
		bytes: Uint8Array;
		contentType: string;
		key: string;
	}): Promise<void> {
		this.writes.set(input.key, {
			bucket: input.bucket,
			bytes: input.bytes,
			contentType: input.contentType,
		});
	}
}

describe("gated reader asset R2 sync", () => {
	it("syncs only gated reader asset source objects by their existing object keys", async () => {
		const manifestPath = writeManifest({
			documentVersions: [
				{
					deliveryMode: "public_static_asset",
					versionId: "ver_public",
				},
				{
					deliveryMode: "gated_asset",
					versionId: "ver_restricted",
				},
			],
			readerAssets: [
				{
					sourceObjects: {
						reader: "reader-assets/public/reader.json",
					},
					versionId: "ver_public",
				},
				{
					sourceObjects: {
						manifest: "reader-assets/restricted/asset-manifest.json",
						outline: "reader-assets/restricted/outline.json",
						reader: "reader-assets/restricted/reader.json",
					},
					versionId: "ver_restricted",
				},
			],
		});
		const target = new FakeWritableObjectStore();

		const result = await syncGatedReaderAssetsToBucket({
			manifestFilePath: manifestPath,
			sourceClient: new FakeObjectStore(
				new Map([
					["reader-assets/public/reader.json", "{}"],
					["reader-assets/restricted/asset-manifest.json", '{"files":{}}'],
					["reader-assets/restricted/outline.json", '{"nodes":[]}'],
					["reader-assets/restricted/reader.json", '{"sections":[]}'],
				]),
			),
			targetBucket: "campus-agent-reader-assets-staging",
			targetClient: target,
		});

		expect(result).toEqual({
			gatedDocumentCount: 1,
			skippedDuplicateObjectCount: 0,
			syncedObjectCount: 3,
		});
		expect([...target.writes.keys()].sort()).toEqual([
			"reader-assets/restricted/asset-manifest.json",
			"reader-assets/restricted/outline.json",
			"reader-assets/restricted/reader.json",
		]);
		expect(target.writes.get("reader-assets/restricted/reader.json")?.bucket).toBe(
			"campus-agent-reader-assets-staging",
		);
		expect(target.writes.get("reader-assets/restricted/reader.json")?.contentType).toBe(
			"application/json; charset=utf-8",
		);
	});

	it("fails closed on missing gated source objects and unsafe keys", async () => {
		const missingManifestPath = writeManifest({
			documentVersions: [{ deliveryMode: "gated_asset", versionId: "ver_restricted" }],
			readerAssets: [
				{
					sourceObjects: { reader: "reader-assets/restricted/missing.json" },
					versionId: "ver_restricted",
				},
			],
		});

		await expect(
			syncGatedReaderAssetsToBucket({
				manifestFilePath: missingManifestPath,
				sourceClient: new FakeObjectStore(new Map()),
				targetClient: new FakeWritableObjectStore(),
			}),
		).rejects.toThrow("missing gated reader asset source object");

		const unsafeManifestPath = writeManifest({
			documentVersions: [{ deliveryMode: "gated_asset", versionId: "ver_restricted" }],
			readerAssets: [
				{
					sourceObjects: { reader: "../restricted/reader.json" },
					versionId: "ver_restricted",
				},
			],
		});

		await expect(
			syncGatedReaderAssetsToBucket({
				manifestFilePath: unsafeManifestPath,
				sourceClient: new FakeObjectStore(new Map()),
				targetClient: new FakeWritableObjectStore(),
			}),
		).rejects.toThrow("unsafe gated reader asset source object key");
	});
});
