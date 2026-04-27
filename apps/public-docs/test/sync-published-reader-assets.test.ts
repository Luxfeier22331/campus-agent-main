import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { syncPublishedReaderAssets } from "../scripts/sync-published-reader-assets";
import { FakeObjectStore, temporaryDirectories } from "./sync-real-docs-test-support";

function createTargetRoot(): string {
	const targetRoot = mkdtempSync(join(tmpdir(), "public-docs-reader-assets-"));
	temporaryDirectories.push(targetRoot);
	return targetRoot;
}

function assetManifest(files: Record<string, string>): string {
	return JSON.stringify({
		files: Object.fromEntries(
			Object.entries(files).map(([name, content]) => [
				name,
				{
					sha256: createHash("sha256").update(content).digest("hex"),
					sizeBytes: new TextEncoder().encode(content).byteLength,
				},
			]),
		),
	});
}

describe("published reader asset sync", () => {
	it("copies only public static asset entries from the deploy sync manifest", async () => {
		const targetRoot = createTargetRoot();
		const manifest = {
			entries: [
				{
					deliveryMode: "public_static_asset",
					docId: "curriculum:law-ethnic-class-program",
					sourceObjects: {
						manifest: "reader-assets/law/asset-manifest.json",
						outline: "reader-assets/law/outline.json",
						reader: "reader-assets/law/reader.json",
					},
					targetObjects: {
						"asset-manifest":
							"_docs/curriculum/curriculum_plan/law/2026-current/asset-manifest.json",
						outline: "_docs/curriculum/curriculum_plan/law/2026-current/outline.json",
						reader: "_docs/curriculum/curriculum_plan/law/2026-current/reader.json",
					},
				},
				{
					deliveryMode: "gated_asset",
					docId: "curriculum:restricted-program",
					sourceObjects: {
						manifest: "reader-assets/restricted/asset-manifest.json",
						reader: "reader-assets/restricted/reader.json",
					},
					targetObjects: {
						"asset-manifest":
							"_docs/curriculum/curriculum_plan/restricted/2026-current/asset-manifest.json",
						reader: "_docs/curriculum/curriculum_plan/restricted/2026-current/reader.json",
					},
				},
			],
			generatedAt: "2026-04-23T08:30:00.000Z",
			surface: "public_docs",
		};
		const objectStore = new FakeObjectStore(
			new Map([
				["manifests/public-docs-sync.json", JSON.stringify(manifest)],
				["reader-assets/law/outline.json", '{"nodes":[]}'],
				["reader-assets/law/reader.json", '{"sections":[]}'],
				[
					"reader-assets/law/asset-manifest.json",
					assetManifest({
						"outline.json": '{"nodes":[]}',
						"reader.json": '{"sections":[]}',
					}),
				],
				[
					"reader-assets/restricted/asset-manifest.json",
					assetManifest({
						"reader.json": '{"restricted":true}',
					}),
				],
				["reader-assets/restricted/reader.json", '{"restricted":true}'],
			]),
		);

		const result = await syncPublishedReaderAssets({
			client: objectStore,
			manifestObjectKey: "manifests/public-docs-sync.json",
			targetRoot,
		});

		expect(result).toEqual({
			copiedAssetCount: 5,
			copiedDocumentCount: 2,
			copiedGatedDocumentCount: 1,
			copiedPublicDocumentCount: 1,
		});
		expect(
			readFileSync(
				join(targetRoot, "_docs/curriculum/curriculum_plan/law/2026-current/reader.json"),
				"utf8",
			),
		).toBe('{"sections":[]}');
		expect(
			readFileSync(
				join(
					targetRoot,
					"_gated-docs/curriculum/curriculum_plan/restricted/2026-current/reader.json",
				),
				"utf8",
			),
		).toBe('{"restricted":true}');
	});

	it("fails closed on unsafe target paths, duplicate targets, and missing source objects", async () => {
		const unsafeTargetRoot = createTargetRoot();
		await expect(
			syncPublishedReaderAssets({
				client: new FakeObjectStore(
					new Map([
						[
							"manifest.json",
							JSON.stringify({
								entries: [
									{
										deliveryMode: "public_static_asset",
										docId: "unsafe",
										sourceObjects: {
											manifest: "asset-manifest.json",
											reader: "reader.json",
										},
										targetObjects: {
											"asset-manifest":
												"_docs/corpus/collection/doc/2026-current/asset-manifest.json",
											reader: "../reader.json",
										},
									},
								],
							}),
						],
						["asset-manifest.json", assetManifest({ "reader.json": "{}" })],
						["reader.json", "{}"],
					]),
				),
				manifestObjectKey: "manifest.json",
				targetRoot: unsafeTargetRoot,
			}),
		).rejects.toThrow("public reader asset target must stay under _docs/");

		const duplicateTargetRoot = createTargetRoot();
		await expect(
			syncPublishedReaderAssets({
				client: new FakeObjectStore(
					new Map([
						[
							"manifest.json",
							JSON.stringify({
								entries: [
									{
										deliveryMode: "public_static_asset",
										docId: "doc-a",
										sourceObjects: {
											manifest: "asset-manifest-a.json",
											reader: "reader-a.json",
										},
										targetObjects: {
											"asset-manifest":
												"_docs/corpus/collection/doc-a/2026-current/asset-manifest.json",
											reader: "_docs/corpus/collection/doc-a/2026-current/reader.json",
										},
									},
									{
										deliveryMode: "public_static_asset",
										docId: "doc-b",
										sourceObjects: {
											manifest: "asset-manifest-b.json",
											reader: "reader-b.json",
										},
										targetObjects: {
											"asset-manifest":
												"_docs/corpus/collection/doc-b/2026-current/asset-manifest.json",
											reader: "_docs/corpus/collection/doc-a/2026-current/reader.json",
										},
									},
								],
							}),
						],
						["asset-manifest-a.json", assetManifest({ "reader.json": "{}" })],
						["asset-manifest-b.json", assetManifest({ "reader.json": "{}" })],
						["reader-a.json", "{}"],
						["reader-b.json", "{}"],
					]),
				),
				manifestObjectKey: "manifest.json",
				targetRoot: duplicateTargetRoot,
			}),
		).rejects.toThrow("duplicate reader asset target");

		const missingSourceTargetRoot = createTargetRoot();
		await expect(
			syncPublishedReaderAssets({
				client: new FakeObjectStore(
					new Map([
						[
							"manifest.json",
							JSON.stringify({
								entries: [
									{
										deliveryMode: "public_static_asset",
										docId: "doc-a",
										sourceObjects: {
											manifest: "asset-manifest.json",
											reader: "missing-reader.json",
										},
										targetObjects: {
											"asset-manifest":
												"_docs/corpus/collection/doc/2026-current/asset-manifest.json",
											reader: "_docs/corpus/collection/doc/2026-current/reader.json",
										},
									},
								],
							}),
						],
						["asset-manifest.json", assetManifest({ "reader.json": "{}" })],
					]),
				),
				manifestObjectKey: "manifest.json",
				targetRoot: missingSourceTargetRoot,
			}),
		).rejects.toThrow("missing reader asset source object");
	});
});
