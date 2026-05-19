import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
	buildBundleRecord,
	runBootstrapExport,
	uploadBootstrapArtifacts,
	writeBootstrapArtifacts,
} from "../src/bootstrap-export.js";
import type { CollectorRunLedgerRecord } from "../src/collector-run-ledger.js";
import type { BootstrapExportManifest } from "../src/types.js";

export function registerBootstrapExportWriteArtifactsSuite(tempDirs: string[]) {
	it("writes notices bundle and export manifest under the configured exports directory", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-bootstrap-export-"));
		tempDirs.push(tempDir);

		const written = writeBootstrapArtifacts({
			bundleRecords: [
				buildBundleRecord({
					detailInfo: {
						notice_content: "<p>通知正文</p>",
						notice_id: 355119,
						notice_link: "https://portal.example.edu/notice/355119",
					},
					observedAt: "2026-04-04T01:23:45.000Z",
					notice: {
						notice_id: 355119,
						notice_title: "通知标题",
						notice_type: "5",
						notice_type_name: "办公通知",
					},
				}),
			],
			exportManifest: {
				export_date: "20260404",
				export_scope: "bootstrap-20260404T012345Z",
				exported_at: "2026-04-04T01:23:45.000Z",
				full_scope_completed: false,
				full_scope_requested: false,
				filters: {
					collection_mode: "incremental",
					max_notices: null,
					notice_types: ["5"],
				},
				observed_notice_types: [
					{
						notice_type_id: 5,
						notice_type_name: "办公通知",
					},
				],
				observed_organizations: [
					{
						organization_id: "00011",
						organization_name: "教务处（考试中心、教师教学发展中心）",
					},
				],
				collector: {
					attachment_collection_mode: "detail_api_and_html_reference_only",
					attachment_storage_mode: "reference_only",
					export_contract_version: "authenticated_notice_collector_export_v2",
					link_collection_mode: "html_reference_only",
					runtime_shell: "repo_local_node",
				},
				notice_type_policy: [
					{
						backfill: {
							page_size: 20,
							pages: 1,
						},
						enabled: true,
						incremental: {
							page_size: 20,
							pages: 1,
						},
						name: "办公通知",
						type: "5",
					},
				],
				run: {
					detail_fetched: 1,
					errors: 0,
					finished_at: "2026-04-04T01:23:45.000Z",
					items_inserted: 1,
					items_seen: 1,
					mode: "incremental",
					pages_fetched: 1,
					started_at: "2026-04-04T01:23:45.000Z",
					status: "success",
				},
				schema_version: "authenticated_notice_collector_export_v2",
				site_id: "muc_internal_portal",
				source_channel: "authenticated_notice_portal",
				source_home_url: "https://portal.example.edu/home",
				source_surface: "notice",
				page_budget_exhausted: false,
			},
			outputDir: tempDir,
		});

		expect(path.basename(written.bundlePath)).toBe("notices-bundle-20260404T012345Z.json");
		expect(path.basename(written.manifestPath)).toBe("export-manifest-20260404T012345Z.json");
		expect(JSON.parse(fs.readFileSync(written.bundlePath, "utf-8"))).toHaveLength(1);
		expect(JSON.parse(fs.readFileSync(written.manifestPath, "utf-8")).site_id).toBe(
			"muc_internal_portal",
		);
	});

	it("uploads exported bundle and manifest as source-channel artifact refs", async () => {
		const uploaded: Array<{
			contentType: string;
			data: string;
			metadata?: unknown;
			objectKey: string;
		}> = [];
		const bundleRecords = [{ notice_id: 355119 }];
		const exportManifest = { exported_at: "2026-04-04T01:23:45.000Z" };

		const refs = await uploadBootstrapArtifacts({
			artifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
				async putObject({ objectKey, data, contentType, metadata }) {
					uploaded.push({
						contentType,
						data: Buffer.from(data).toString("utf-8"),
						metadata,
						objectKey,
					});
					return {
						bucket: "campus-rag-source",
						byteSize: data.byteLength,
						contentSha256: "a".repeat(64),
						etag: '"etag"',
						objectKey,
						versionId: null,
					};
				},
			},
			bundleRecords,
			exportedAt: "2026-04-04T01:23:45.000Z",
			exportManifest,
			siteId: "muc_internal_portal",
		});

		const expectedBundleBytes = `${JSON.stringify(bundleRecords, null, 2)}\n`;
		const expectedManifestBytes = `${JSON.stringify(exportManifest, null, 2)}\n`;
		expect(refs).toEqual({
			bundleByteSize: Buffer.byteLength(expectedBundleBytes),
			bundleContentSha256: "a".repeat(64),
			bundleObjectKey:
				"authenticated_notice_portal/runs/muc_internal_portal/20260404T012345Z/notices-bundle.json",
			bundleRef: {
				bucket: "campus-rag-source",
				byteSize: Buffer.byteLength(expectedBundleBytes),
				contentSha256: "a".repeat(64),
				etag: '"etag"',
				objectKey:
					"authenticated_notice_portal/runs/muc_internal_portal/20260404T012345Z/notices-bundle.json",
				versionId: null,
			},
			manifestByteSize: Buffer.byteLength(expectedManifestBytes),
			manifestContentSha256: "a".repeat(64),
			manifestObjectKey:
				"authenticated_notice_portal/runs/muc_internal_portal/20260404T012345Z/export-manifest.json",
			manifestRef: {
				bucket: "campus-rag-source",
				byteSize: Buffer.byteLength(expectedManifestBytes),
				contentSha256: "a".repeat(64),
				etag: '"etag"',
				objectKey:
					"authenticated_notice_portal/runs/muc_internal_portal/20260404T012345Z/export-manifest.json",
				versionId: null,
			},
			sourceBucket: "campus-rag-source",
		});
		expect(uploaded.map((item) => item.data)).toEqual([expectedBundleBytes, expectedManifestBytes]);
		expect(uploaded.map((item) => item.contentType)).toEqual([
			"application/json",
			"application/json",
		]);
		expect(uploaded[0].metadata).toMatchObject({
			artifact_kind: "notices_bundle",
			site_id: "muc_internal_portal",
		});
	});

	it("records started then failed when verified object handoff upload fails", async () => {
		const ledgerWrites: CollectorRunLedgerRecord[] = [];
		const exportManifest = sampleBootstrapManifest();

		await expect(
			runBootstrapExport({
				artifactStore: {
					storageProvider: "object_store",
					headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
					putObject: async () => {
						throw new Error("upload boom");
					},
				},
				collectBundle: async () => ({
					bundleRecords: [],
					exportManifest,
					stats: {
						attachmentObjectsUploaded: 0,
						detailFetched: 0,
						noticesCollected: 0,
						pagesFetched: 0,
					},
				}),
				collectionMode: "incremental",
				collectorRunLedgerStore: {
					upsertRun: async (record) => {
						ledgerWrites.push(record);
					},
				},
				exportedAt: "2026-04-04T01:23:45.000Z",
				siteId: "muc_internal_portal",
				sourceHomeUrl: "https://portal.example.edu/home",
				writeLocalArtifacts: false,
			}),
		).rejects.toThrow("upload boom");

		expect(ledgerWrites.map((record) => record.status)).toEqual(["started", "failed"]);
		expect(ledgerWrites[0]).toMatchObject({
			bundlePath: null,
			manifestPath: null,
			status: "started",
		});
		expect(ledgerWrites[1]).toMatchObject({
			bundlePath: null,
			failureReason: "upload boom",
			manifestPath: null,
			status: "failed",
		});
	});

	it("calls verified-run enqueue hook only after successful verified ledger write", async () => {
		const ledgerWrites: CollectorRunLedgerRecord[] = [];
		const enqueuedRunIds: string[] = [];
		const exportManifest = sampleBootstrapManifest();

		const result = await runBootstrapExport({
			artifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
				async putObject({ objectKey, data }) {
					return {
						bucket: "campus-rag-source",
						byteSize: data.byteLength,
						contentSha256: "a".repeat(64),
						etag: '"etag"',
						objectKey,
						versionId: null,
					};
				},
			},
			collectBundle: async () => ({
				bundleRecords: [],
				exportManifest,
				stats: {
					attachmentObjectsUploaded: 0,
					detailFetched: 0,
					noticesCollected: 0,
					pagesFetched: 0,
				},
			}),
			collectionMode: "incremental",
			collectorRunLedgerStore: {
				upsertRun: async (record) => {
					ledgerWrites.push(record);
				},
			},
			exportedAt: "2026-04-04T01:23:45.000Z",
			siteId: "muc_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
			verifiedRunEnqueue: async ({ ledgerRecord }) => {
				enqueuedRunIds.push(ledgerRecord.runId);
			},
			writeLocalArtifacts: false,
		});

		expect(ledgerWrites.map((record) => record.status)).toEqual(["started", "success"]);
		expect(enqueuedRunIds).toEqual([result.ledgerRecord.runId]);
		expect(result.ledgerRecord.verificationStatus).toBe("verified");
	});
}

function sampleBootstrapManifest(): BootstrapExportManifest {
	return {
		collector: {
			attachment_collection_mode: "detail_api_and_html_materialized",
			attachment_storage_mode: "object_store_write",
			export_contract_version: "authenticated_notice_collector_export_v2",
			link_collection_mode: "html_reference_only",
			runtime_shell: "repo_local_node",
		},
		export_date: "20260404",
		export_scope: "bootstrap-20260404T012345Z",
		exported_at: "2026-04-04T01:23:45.000Z",
		full_scope_completed: false,
		full_scope_requested: false,
		filters: {
			collection_mode: "incremental",
			max_notices: null,
			notice_types: ["5"],
		},
		notice_type_policy: [],
		observed_notice_types: [],
		observed_organizations: [],
		page_budget_exhausted: false,
		run: {
			detail_fetched: 0,
			errors: 0,
			finished_at: "2026-04-04T01:23:45.000Z",
			items_inserted: 0,
			items_seen: 0,
			mode: "incremental",
			pages_fetched: 0,
			started_at: "2026-04-04T01:23:45.000Z",
			status: "success",
		},
		schema_version: "authenticated_notice_collector_export_v2",
		site_id: "muc_internal_portal",
		source_channel: "authenticated_notice_portal",
		source_home_url: "https://portal.example.edu/home",
		source_surface: "notice",
	};
}

function fakeArtifactHead(objectKey: string) {
	return {
		bucket: "campus-rag-source",
		objectKey,
		contentSha256: null,
		byteSize: null,
		etag: null,
		versionId: null,
	};
}
