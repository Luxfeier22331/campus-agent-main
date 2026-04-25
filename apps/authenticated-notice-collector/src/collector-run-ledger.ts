import { Pool } from "pg";

import type { BootstrapExportManifest, BundleNoticeRecord, NoticeCollectionMode } from "./types";

export interface CollectorRunLedgerRecord {
	runId: string;
	siteId: string;
	sourceSurface: "notice";
	collectionMode: NoticeCollectionMode;
	sourceHomeUrl: string;
	noticeTypeIds: string[];
	selectedNoticeIds: string[];
	bundlePath: string;
	manifestPath: string;
	bundleObjectKey: string | null;
	manifestObjectKey: string | null;
	noticesCollected: number;
	pagesFetched: number;
	detailFetched: number;
	itemsSeen: number;
	attachmentRefsSeen: number;
	attachmentUploaded: number;
	attachmentTerminalUnavailable: number;
	attachmentTransientFailed: number;
	attachmentReferenceOnly: number;
	status: "success";
	errorCount: number;
	startedAt: string;
	finishedAt: string;
	record: Record<string, unknown>;
}

export interface CollectorRunLedgerStore {
	upsertRun(record: CollectorRunLedgerRecord): Promise<void>;
}

export interface DisposableCollectorRunLedgerStore extends CollectorRunLedgerStore {
	dispose(): Promise<void>;
}

export interface CollectorRunLedgerTableReference {
	schemaSql?: string;
	tableSql: string;
}

const DEFAULT_RUN_LEDGER_TABLE_NAME = "ingestion_projection.authenticated_notice_collector_run";

export function buildCollectorRunLedgerRecord(input: {
	bundleObjectKey?: string | null;
	bundlePath: string;
	bundleRecords: BundleNoticeRecord[];
	collectionMode: NoticeCollectionMode;
	exportedAt: string;
	manifest: BootstrapExportManifest;
	manifestObjectKey?: string | null;
	manifestPath: string;
	runId?: string;
	siteId: string;
	sourceHomeUrl: string;
}): CollectorRunLedgerRecord {
	const attachmentFacts = aggregateAttachmentFacts(input.bundleRecords);
	const selectedNoticeIds = input.manifest.filters.selected_notice_ids ?? [];
	const record = {
		run_id: input.runId ?? buildRunId(input.exportedAt, input.siteId),
		site_id: input.siteId,
		source_surface: "notice",
		collection_mode: input.collectionMode,
		source_home_url: input.sourceHomeUrl,
		notice_type_ids: input.manifest.filters.notice_types,
		selected_notice_ids: selectedNoticeIds,
		bundle_path: input.bundlePath,
		manifest_path: input.manifestPath,
		bundle_object_key: input.bundleObjectKey ?? null,
		manifest_object_key: input.manifestObjectKey ?? null,
		notices_collected: input.bundleRecords.length,
		pages_fetched: input.manifest.run.pages_fetched,
		detail_fetched: input.manifest.run.detail_fetched,
		items_seen: input.manifest.run.items_seen,
		attachment_refs_seen: attachmentFacts.attachmentRefsSeen,
		attachment_uploaded: attachmentFacts.attachmentUploaded,
		attachment_terminal_unavailable: attachmentFacts.attachmentTerminalUnavailable,
		attachment_transient_failed: attachmentFacts.attachmentTransientFailed,
		attachment_reference_only: attachmentFacts.attachmentReferenceOnly,
		status: "success",
		error_count: input.manifest.run.errors,
		started_at: input.manifest.run.started_at,
		finished_at: input.manifest.run.finished_at,
		export_manifest: input.manifest,
	};
	return {
		runId: record.run_id,
		siteId: record.site_id,
		sourceSurface: "notice",
		collectionMode: input.collectionMode,
		sourceHomeUrl: input.sourceHomeUrl,
		noticeTypeIds: [...input.manifest.filters.notice_types],
		selectedNoticeIds: [...selectedNoticeIds],
		bundlePath: input.bundlePath,
		manifestPath: input.manifestPath,
		bundleObjectKey: input.bundleObjectKey ?? null,
		manifestObjectKey: input.manifestObjectKey ?? null,
		noticesCollected: input.bundleRecords.length,
		pagesFetched: input.manifest.run.pages_fetched,
		detailFetched: input.manifest.run.detail_fetched,
		itemsSeen: input.manifest.run.items_seen,
		attachmentRefsSeen: attachmentFacts.attachmentRefsSeen,
		attachmentUploaded: attachmentFacts.attachmentUploaded,
		attachmentTerminalUnavailable: attachmentFacts.attachmentTerminalUnavailable,
		attachmentTransientFailed: attachmentFacts.attachmentTransientFailed,
		attachmentReferenceOnly: attachmentFacts.attachmentReferenceOnly,
		status: "success",
		errorCount: input.manifest.run.errors,
		startedAt: input.manifest.run.started_at,
		finishedAt: input.manifest.run.finished_at,
		record,
	};
}

export function createInMemoryCollectorRunLedgerStore(): CollectorRunLedgerStore & {
	records(): CollectorRunLedgerRecord[];
} {
	const rows: CollectorRunLedgerRecord[] = [];
	return {
		async upsertRun(record) {
			const existingIndex = rows.findIndex((item) => item.runId === record.runId);
			if (existingIndex >= 0) {
				rows[existingIndex] = record;
				return;
			}
			rows.push(record);
		},
		records() {
			return [...rows];
		},
	};
}

export function createPostgresCollectorRunLedgerStore(input: {
	databaseUrl: string;
	tableName?: string;
}): DisposableCollectorRunLedgerStore {
	const tableReference = resolveCollectorRunLedgerTableReference(
		input.tableName ?? DEFAULT_RUN_LEDGER_TABLE_NAME,
	);
	const pool = new Pool({ connectionString: input.databaseUrl });
	return {
		async upsertRun(record) {
			await ensureCollectorRunLedgerSchema(pool, tableReference);
			await pool.query(
				`
				insert into ${tableReference.tableSql} (
					run_id,
					site_id,
					source_surface,
					collection_mode,
					source_home_url,
					notice_type_ids,
					selected_notice_ids,
					bundle_path,
					manifest_path,
					bundle_object_key,
					manifest_object_key,
					notices_collected,
					pages_fetched,
					detail_fetched,
					items_seen,
					attachment_refs_seen,
					attachment_uploaded,
					attachment_terminal_unavailable,
					attachment_transient_failed,
					attachment_reference_only,
					status,
					error_count,
					started_at,
					finished_at,
					record
				) values (
					$1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
					$11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
					$21, $22, $23, $24, $25
				)
				on conflict (run_id) do update set
					site_id = excluded.site_id,
					source_surface = excluded.source_surface,
					collection_mode = excluded.collection_mode,
					source_home_url = excluded.source_home_url,
					notice_type_ids = excluded.notice_type_ids,
					selected_notice_ids = excluded.selected_notice_ids,
					bundle_path = excluded.bundle_path,
					manifest_path = excluded.manifest_path,
					bundle_object_key = excluded.bundle_object_key,
					manifest_object_key = excluded.manifest_object_key,
					notices_collected = excluded.notices_collected,
					pages_fetched = excluded.pages_fetched,
					detail_fetched = excluded.detail_fetched,
					items_seen = excluded.items_seen,
					attachment_refs_seen = excluded.attachment_refs_seen,
					attachment_uploaded = excluded.attachment_uploaded,
					attachment_terminal_unavailable = excluded.attachment_terminal_unavailable,
					attachment_transient_failed = excluded.attachment_transient_failed,
					attachment_reference_only = excluded.attachment_reference_only,
					status = excluded.status,
					error_count = excluded.error_count,
					started_at = excluded.started_at,
					finished_at = excluded.finished_at,
					record = excluded.record
				`,
				[
					record.runId,
					record.siteId,
					record.sourceSurface,
					record.collectionMode,
					record.sourceHomeUrl,
					record.noticeTypeIds,
					record.selectedNoticeIds,
					record.bundlePath,
					record.manifestPath,
					record.bundleObjectKey,
					record.manifestObjectKey,
					record.noticesCollected,
					record.pagesFetched,
					record.detailFetched,
					record.itemsSeen,
					record.attachmentRefsSeen,
					record.attachmentUploaded,
					record.attachmentTerminalUnavailable,
					record.attachmentTransientFailed,
					record.attachmentReferenceOnly,
					record.status,
					record.errorCount,
					record.startedAt,
					record.finishedAt,
					record.record,
				],
			);
		},
		async dispose() {
			await pool.end();
		},
	};
}

function aggregateAttachmentFacts(bundleRecords: BundleNoticeRecord[]): {
	attachmentReferenceOnly: number;
	attachmentRefsSeen: number;
	attachmentTerminalUnavailable: number;
	attachmentTransientFailed: number;
	attachmentUploaded: number;
} {
	let attachmentReferenceOnly = 0;
	let attachmentRefsSeen = 0;
	let attachmentTerminalUnavailable = 0;
	let attachmentTransientFailed = 0;
	let attachmentUploaded = 0;
	for (const bundleRecord of bundleRecords) {
		attachmentRefsSeen += bundleRecord.notice_attachments.length;
		for (const attachment of bundleRecord.attachments) {
			if (
				attachment.storage_provider !== "reference_only" &&
				(attachment.ingest_status === "uploaded" || attachment.ingest_status === "downloaded")
			) {
				attachmentUploaded += 1;
				continue;
			}
			if (attachment.storage_provider === "reference_only") {
				attachmentReferenceOnly += 1;
			}
			const lastError = attachment.last_error ?? "";
			if (lastError.startsWith("terminal_unavailable:")) {
				attachmentTerminalUnavailable += 1;
			} else if (lastError.trim()) {
				attachmentTransientFailed += 1;
			}
		}
	}
	return {
		attachmentReferenceOnly,
		attachmentRefsSeen,
		attachmentTerminalUnavailable,
		attachmentTransientFailed,
		attachmentUploaded,
	};
}

async function ensureCollectorRunLedgerSchema(
	pool: Pool,
	tableReference: CollectorRunLedgerTableReference,
): Promise<void> {
	if (tableReference.schemaSql) {
		await pool.query(`create schema if not exists ${tableReference.schemaSql}`);
	}
	await pool.query(`
		create table if not exists ${tableReference.tableSql} (
			run_id text primary key,
			site_id text not null,
			source_surface text not null,
			collection_mode text not null,
			source_home_url text not null,
			notice_type_ids text[] not null,
			selected_notice_ids text[] not null,
			bundle_path text not null,
			manifest_path text not null,
			bundle_object_key text,
			manifest_object_key text,
			notices_collected integer not null,
			pages_fetched integer not null,
			detail_fetched integer not null,
			items_seen integer not null,
			attachment_refs_seen integer not null,
			attachment_uploaded integer not null,
			attachment_terminal_unavailable integer not null,
			attachment_transient_failed integer not null,
			attachment_reference_only integer not null,
			status text not null,
			error_count integer not null,
			started_at timestamptz not null,
			finished_at timestamptz not null,
			record jsonb not null
		)
	`);
}

function buildRunId(exportedAt: string, siteId: string): string {
	return `${siteId}:${exportedAt.replace(/[^0-9A-Za-z]/g, "")}`;
}

export function resolveCollectorRunLedgerTableReference(
	tableName: string,
): CollectorRunLedgerTableReference {
	const parts = tableName.split(".");
	if (parts.length === 0 || parts.length > 2) {
		throw new Error(`invalid collector run ledger table name: ${tableName}`);
	}
	const quotedParts = parts.map(quoteIdentifier);
	if (quotedParts.length === 1) {
		return { tableSql: quotedParts[0] };
	}
	return {
		schemaSql: quotedParts[0],
		tableSql: quotedParts.join("."),
	};
}

function quoteIdentifier(identifier: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
		throw new Error(`invalid collector run ledger table identifier: ${identifier}`);
	}
	return `"${identifier}"`;
}
