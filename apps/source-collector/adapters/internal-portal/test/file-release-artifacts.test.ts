import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	buildAuthenticatedNoticeFileReleaseCaptureKey,
	buildFileReleaseRecord,
	uploadFileReleaseArtifacts,
	writeFileReleaseArtifacts,
} from "../src/file-release-export.js";

describe("internal portal source collector file release artifacts", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("writes file release bundle and manifest under the configured exports directory", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-file-release-export-"));
		tempDirs.push(tempDir);

		const written = writeFileReleaseArtifacts({
			bundleRecords: [
				buildFileReleaseRecord({
					detail: {
						filecode: "民大校发〔2026〕39号",
						filedepartment: "教务处",
						filename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
						filetime: "2026-03-31 13:51:11",
						filetypeid: 18,
						fileurl: "/comsys/20181214/webapps/comsys-prompt-portlet-web/file/sample.pdf",
						id: 646,
						state: 1,
						upfilename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法.pdf",
					},
					downloadUrl: "/comsys-prompt-portlet-web/file/sample.pdf",
					fileTypeNameById: new Map([[18, "教学管理"]]),
					item: {
						filecode: "民大校发〔2026〕39号",
						filedepartment: "教务处",
						filename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
						filetime: "2026-03-31 13:51:11",
						id: 646,
						typename: "教学管理",
						user_name: "张老师",
					},
					observedAt: "2026-04-12T00:30:00.000Z",
					sourceHomeUrl: "https://portal.example.edu",
				}),
			],
			exportManifest: {
				capture_runtime: {
					export_contract_version: "internal_portal_file_release_export_v1",
					file_release_collection_mode: "prompt_portlet_reference_only",
					file_storage_mode: "reference_only",
					runtime_shell: "source_collector_node",
				},
				export_date: "20260412",
				export_scope: "file-release-20260412T003000Z",
				exported_at: "2026-04-12T00:30:00.000Z",
				filters: {
					max_file_releases: null,
					max_pages: null,
					page_size: 10,
					target_file_release_id: null,
				},
				observed_departments: ["教务处"],
				observed_explain_departments: ["教务处（考试中心、教师教学发展中心）"],
				observed_file_code_types: [
					{
						id: 2,
						name: "民大校发",
						sort: 2,
					},
				],
				observed_file_types: [
					{
						id: 18,
						sort: 3,
						typename: "教学管理",
					},
				],
				run: {
					detail_fetched: 1,
					errors: 0,
					file_urls_resolved: 1,
					finished_at: "2026-04-12T00:30:00.000Z",
					items_inserted: 1,
					items_seen: 1,
					mode: "file_release_export",
					pages_fetched: 1,
					started_at: "2026-04-12T00:30:00.000Z",
					status: "success",
				},
				schema_version: "internal_portal_file_release_export_v1",
				site_id: "synthetic_internal_portal",
				source_channel: "internal_portal",
				source_home_url: "https://portal.example.edu",
				source_surface: "file_release",
			},
			outputDir: tempDir,
		});

		expect(path.basename(written.bundlePath)).toBe("file-releases-bundle-20260412T003000Z.json");
		expect(path.basename(written.manifestPath)).toBe(
			"file-releases-manifest-20260412T003000Z.json",
		);
		expect(JSON.parse(fs.readFileSync(written.bundlePath, "utf-8"))).toHaveLength(1);
		expect(JSON.parse(fs.readFileSync(written.manifestPath, "utf-8")).source_surface).toBe(
			"file_release",
		);
	});

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
			artifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
				putObject: async ({ objectKey, contentType, metadata, data }) => {
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
			siteId: "synthetic_internal_portal",
		});

		const expectedBundleBytes = `${JSON.stringify(bundleRecords, null, 2)}\n`;
		const expectedManifestBytes = `${JSON.stringify(exportManifest, null, 2)}\n`;
		expect(uploaded).toEqual({
			bundleByteSize: Buffer.byteLength(expectedBundleBytes),
			bundleContentSha256: "sha256",
			bundleObjectKey:
				"internal_portal/runs/synthetic_internal_portal/20260412T003000Z/file-releases-bundle.json",
			bundleRef: {
				bucket: "campus-agent-source",
				byteSize: Buffer.byteLength(expectedBundleBytes),
				contentSha256: "sha256",
				etag: '"etag"',
				objectKey:
					"internal_portal/runs/synthetic_internal_portal/20260412T003000Z/file-releases-bundle.json",
				versionId: null,
			},
			manifestByteSize: Buffer.byteLength(expectedManifestBytes),
			manifestContentSha256: "sha256",
			manifestObjectKey:
				"internal_portal/runs/synthetic_internal_portal/20260412T003000Z/file-releases-manifest.json",
			manifestRef: {
				bucket: "campus-agent-source",
				byteSize: Buffer.byteLength(expectedManifestBytes),
				contentSha256: "sha256",
				etag: '"etag"',
				objectKey:
					"internal_portal/runs/synthetic_internal_portal/20260412T003000Z/file-releases-manifest.json",
				versionId: null,
			},
			sourceBucket: "campus-agent-source",
		});
		expect(storedObjects).toEqual([
			{
				contentType: "application/json",
				data: expectedBundleBytes,
				key: "internal_portal/runs/synthetic_internal_portal/20260412T003000Z/file-releases-bundle.json",
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
				key: "internal_portal/runs/synthetic_internal_portal/20260412T003000Z/file-releases-manifest.json",
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
