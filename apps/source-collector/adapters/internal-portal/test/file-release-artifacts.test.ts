import { describe, expect, it } from "vitest";

import {
	buildAuthenticatedNoticeFileReleaseCaptureKey,
	uploadFileReleaseArtifacts,
} from "../src/file-release-export.js";

describe("internal portal source collector file release artifacts", () => {
	it("uploads file release bundle and manifest as source-channel run artifact refs", async () => {
		const bundleRecords = [{ file_release_id: 646 }];
		const exportManifest = { exported_at: "2026-04-12T00:30:00.000Z" };

		const storedObjects: Array<{
			contentType: string;
			data: string;
			key: string;
			metadata: Record<string, string> | undefined;
		}> = [];

		const uploaded = await uploadFileReleaseArtifacts({
			activityAttempt: 2,
			artifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
				createOrVerifyObject: async ({ objectKey, contentType, metadata, data }) => {
					storedObjects.push({
						contentType,
						data: Buffer.from(data).toString("utf-8"),
						key: objectKey,
						metadata,
					});
					return {
						bucket: "campus-agent-source",
						byteSize: data.byteLength,
						contentSha256: "sha256",
						etag: '"etag"',
						objectKey,
						versionId: null,
					};
				},
			},
			bundleRecords,
			exportedAt: "2026-04-12T00:30:00.000Z",
			exportManifest,
			runId: "run-file-release",
			siteId: "synthetic_internal_portal",
		});

		const expectedBundleBytes = `${JSON.stringify(bundleRecords, null, 2)}\n`;
		const expectedManifestBytes = `${JSON.stringify(exportManifest, null, 2)}\n`;
		expect(uploaded).toEqual({
			bundleByteSize: Buffer.byteLength(expectedBundleBytes),
			bundleContentSha256: "sha256",
			bundleObjectKey:
				"internal_portal/synthetic_internal_portal/runs/run-file-release/attempts/2/file-release/file-releases-bundle.json",
			bundleRef: {
				bucket: "campus-agent-source",
				byteSize: Buffer.byteLength(expectedBundleBytes),
				contentSha256: "sha256",
				etag: '"etag"',
				objectKey:
					"internal_portal/synthetic_internal_portal/runs/run-file-release/attempts/2/file-release/file-releases-bundle.json",
				versionId: null,
			},
			manifestByteSize: Buffer.byteLength(expectedManifestBytes),
			manifestContentSha256: "sha256",
			manifestObjectKey:
				"internal_portal/synthetic_internal_portal/runs/run-file-release/attempts/2/file-release/file-releases-manifest.json",
			manifestRef: {
				bucket: "campus-agent-source",
				byteSize: Buffer.byteLength(expectedManifestBytes),
				contentSha256: "sha256",
				etag: '"etag"',
				objectKey:
					"internal_portal/synthetic_internal_portal/runs/run-file-release/attempts/2/file-release/file-releases-manifest.json",
				versionId: null,
			},
			sourceBucket: "campus-agent-source",
		});
		expect(storedObjects).toEqual([
			{
				contentType: "application/json",
				data: expectedBundleBytes,
				key: "internal_portal/synthetic_internal_portal/runs/run-file-release/attempts/2/file-release/file-releases-bundle.json",
				metadata: {
					artifact_kind: "file_release_bundle",
					site_id: "synthetic_internal_portal",
					source_channel: "internal_portal",
					source_surface: "file_release",
				},
			},
			{
				contentType: "application/json",
				data: expectedManifestBytes,
				key: "internal_portal/synthetic_internal_portal/runs/run-file-release/attempts/2/file-release/file-releases-manifest.json",
				metadata: {
					artifact_kind: "file_release_manifest",
					site_id: "synthetic_internal_portal",
					source_channel: "internal_portal",
					source_surface: "file_release",
				},
			},
		]);
	});

	it("builds ADR-aligned object keys for file release capture bytes", () => {
		expect(
			buildAuthenticatedNoticeFileReleaseCaptureKey({
				contentSha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
				fileReleaseId: 646,
				filename: "sample.pdf",
				year: "2026",
			}),
		).toBe(
			"internal_portal/file-release-646/2026/sha256-2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/capture/sample.pdf",
		);
	});
});

function fakeArtifactHead(objectKey: string) {
	return {
		bucket: "campus-agent-source",
		objectKey,
		contentSha256: null,
		byteSize: null,
		etag: null,
		versionId: null,
	};
}
