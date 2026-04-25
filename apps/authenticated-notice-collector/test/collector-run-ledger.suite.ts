import { expect, it } from "vitest";

import {
	buildCollectorRunLedgerRecord,
	createInMemoryCollectorRunLedgerStore,
	resolveCollectorRunLedgerTableReference,
} from "../src/collector-run-ledger";
import type { BootstrapExportManifest, BundleNoticeRecord } from "../src/types";

export function registerCollectorRunLedgerSuite() {
	it("builds a source-channel run ledger record from exported bundle facts", async () => {
		const record = buildCollectorRunLedgerRecord({
			bundlePath: "/tmp/notices-bundle.json",
			bundleRecords: [sampleBundleRecord()],
			collectionMode: "backfill",
			exportedAt: "2026-04-04T01:23:45.000Z",
			manifest: sampleManifest(),
			manifestPath: "/tmp/export-manifest.json",
			runId: "run-20260404",
			siteId: "muc_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(record).toMatchObject({
			runId: "run-20260404",
			siteId: "muc_internal_portal",
			sourceSurface: "notice",
			collectionMode: "backfill",
			bundlePath: "/tmp/notices-bundle.json",
			manifestPath: "/tmp/export-manifest.json",
			noticesCollected: 1,
			attachmentRefsSeen: 3,
			attachmentUploaded: 1,
			attachmentTerminalUnavailable: 1,
			attachmentTransientFailed: 1,
			attachmentReferenceOnly: 2,
			status: "success",
		});
		expect(record.noticeTypeIds).toEqual(["5"]);
		expect(record.selectedNoticeIds).toEqual([]);

		const store = createInMemoryCollectorRunLedgerStore();
		await store.upsertRun(record);

		expect(store.records()).toEqual([record]);
	});

	it("keeps raw schema and quoted table SQL separate for postgres ledger DDL", () => {
		expect(
			resolveCollectorRunLedgerTableReference(
				"ingestion_projection.authenticated_notice_collector_run",
			),
		).toEqual({
			schemaSql: '"ingestion_projection"',
			tableSql: '"ingestion_projection"."authenticated_notice_collector_run"',
		});
	});
}

function sampleManifest(): BootstrapExportManifest {
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
		filters: {
			collection_mode: "backfill",
			max_notices: null,
			notice_types: ["5"],
		},
		notice_type_policy: [
			{
				backfill: { page_size: 20, pages: 2 },
				enabled: true,
				incremental: { page_size: 20, pages: 1 },
				name: "办公通知",
				type: "5",
			},
		],
		observed_notice_types: [],
		observed_organizations: [],
		run: {
			detail_fetched: 1,
			errors: 0,
			finished_at: "2026-04-04T01:23:45.000Z",
			items_inserted: 1,
			items_seen: 1,
			mode: "backfill",
			pages_fetched: 2,
			started_at: "2026-04-04T01:23:45.000Z",
			status: "success",
		},
		schema_version: "authenticated_notice_collector_export_v2",
		site_id: "muc_internal_portal",
		source_channel: "authenticated_notice_portal",
		source_home_url: "https://portal.example.edu/home",
	};
}

function sampleBundleRecord(): BundleNoticeRecord {
	return {
		attachments: [
			{
				attachment_id: 1,
				bucket: "campus-rag-source",
				byte_size: 12,
				created_at: "2026-04-04T01:23:45.000Z",
				downloaded_at: "2026-04-04T01:23:45.000Z",
				etag: '"etag"',
				final_url: "https://portal.example.edu/a.docx",
				ingest_status: "uploaded",
				last_error: null,
				local_path: null,
				mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				normalized_source_url: "https://portal.example.edu/a.docx",
				object_key: "authenticated_notice_portal/a.docx",
				origin_host: "portal.example.edu",
				origin_scope: "internal",
				origin_url_scheme: "https",
				original_filename: "a.docx",
				provenance_status: "collected_internal",
				sha256: "sha256-a",
				source_url: "https://portal.example.edu/a.docx",
				storage_provider: "object_store",
				updated_at: "2026-04-04T01:23:45.000Z",
				uploaded_at: "2026-04-04T01:23:45.000Z",
				version_id: null,
			},
			{
				attachment_id: 2,
				bucket: null,
				byte_size: null,
				created_at: "2026-04-04T01:23:45.000Z",
				downloaded_at: null,
				etag: null,
				final_url: "https://portal.example.edu/missing.pdf",
				ingest_status: "reference_only",
				last_error: "terminal_unavailable:http_404",
				local_path: null,
				mime_type: null,
				normalized_source_url: "https://portal.example.edu/missing.pdf",
				object_key: null,
				origin_host: "portal.example.edu",
				origin_scope: "internal",
				origin_url_scheme: "https",
				original_filename: "missing.pdf",
				provenance_status: "reference_only",
				sha256: null,
				source_url: "https://portal.example.edu/missing.pdf",
				storage_provider: "reference_only",
				updated_at: "2026-04-04T01:23:45.000Z",
				uploaded_at: null,
				version_id: null,
			},
			{
				attachment_id: 3,
				bucket: null,
				byte_size: null,
				created_at: "2026-04-04T01:23:45.000Z",
				downloaded_at: null,
				etag: null,
				final_url: "https://portal.example.edu/timeout.pdf",
				ingest_status: "reference_only",
				last_error: "downloadAttachment failed: timeout",
				local_path: null,
				mime_type: null,
				normalized_source_url: "https://portal.example.edu/timeout.pdf",
				object_key: null,
				origin_host: "portal.example.edu",
				origin_scope: "internal",
				origin_url_scheme: "https",
				original_filename: "timeout.pdf",
				provenance_status: "reference_only",
				sha256: null,
				source_url: "https://portal.example.edu/timeout.pdf",
				storage_provider: "reference_only",
				updated_at: "2026-04-04T01:23:45.000Z",
				uploaded_at: null,
				version_id: null,
			},
		],
		links: [],
		notice: {
			categories: [],
			enrich_attempted_at: "2026-04-04T01:23:45.000Z",
			last_seen_at: "2026-04-04T01:23:45.000Z",
			notice_content: "<p>正文</p>",
			notice_create_time: null,
			notice_first_time: null,
			notice_id: 355119,
			notice_link: null,
			notice_link_state: null,
			notice_release_time: "2026-04-02 18:49",
			notice_source: null,
			notice_state: null,
			notice_stick: null,
			notice_title: "通知 A",
			organization_id: null,
			organization_name: null,
		},
		notice_attachments: [
			{
				anchor_text: "a.docx",
				attachment_id: 1,
				discovered_at: "2026-04-04T01:23:45.000Z",
				link_id: null,
				notice_id: 355119,
				relation_source: "detail_api",
				resource_role: "attachment",
			},
			{
				anchor_text: "missing.pdf",
				attachment_id: 2,
				discovered_at: "2026-04-04T01:23:45.000Z",
				link_id: null,
				notice_id: 355119,
				relation_source: "detail_api",
				resource_role: "attachment",
			},
			{
				anchor_text: "timeout.pdf",
				attachment_id: 3,
				discovered_at: "2026-04-04T01:23:45.000Z",
				link_id: null,
				notice_id: 355119,
				relation_source: "detail_api",
				resource_role: "attachment",
			},
		],
		notice_id: 355119,
	};
}
