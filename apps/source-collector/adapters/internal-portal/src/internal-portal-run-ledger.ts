import { Pool } from "pg";

import type { StoredArtifactRef } from "./artifact-store.js";
import type { AttachmentFetchAdmission } from "./attachment-materialization.js";
import {
	aggregateAttachmentFacts,
	aggregateReleasedFileFacts,
	aggregateRequiredNoticeAttachmentFacts,
} from "./internal-portal-run-ledger-facts.js";
import type {
	BundleFileReleaseRecord,
	BundleNoticeRecord,
	FileReleaseExportManifest,
	NoticeCollectionMode,
	NoticeExportManifest,
} from "./types.js";

export interface InternalPortalRunLedgerRecord {
	runId: string;
	siteId: string;
	sourceSurface: "notice" | "file_release";
	collectionMode: NoticeCollectionMode | "file_release_export";
	sourceHomeUrl: string;
	noticeTypeIds: string[];
	selectedNoticeIds: string[];
	bundlePath: string | null;
	manifestPath: string | null;
	sourceBucket: string | null;
	bundleObjectKey: string | null;
	bundleContentSha256: string | null;
	bundleByteSize: number | null;
	manifestObjectKey: string | null;
	manifestContentSha256: string | null;
	manifestByteSize: number | null;
	noticesCollected: number;
	pagesFetched: number;
	detailFetched: number;
	itemsSeen: number;
	attachmentRefsSeen: number;
	attachmentUploaded: number;
	attachmentTerminalUnavailable: number;
	attachmentTransientFailed: number;
	attachmentReferenceOnly: number;
	status: "started" | "success" | "failed";
	verificationStatus: "verified" | "missing_required_objects";
	requiredSourceObjectCount: number;
	verifiedSourceObjectCount: number;
	missingSourceObjectCount: number;
	checksumMismatchCount: number;
	sizeMismatchCount: number;
	failureReason: string | null;
	errorCount: number;
	startedAt: string;
	finishedAt: string | null;
	record: Record<string, unknown>;
}

export interface InternalPortalRunLedgerStore {
	upsertRun(record: InternalPortalRunLedgerRecord): Promise<void>;
}

export interface DisposableInternalPortalRunLedgerStore extends InternalPortalRunLedgerStore {
	dispose(): Promise<void>;
}

export interface InternalPortalRunLedgerTableReference {
	schemaSql?: string;
	tableSql: string;
}

const DEFAULT_RUN_LEDGER_TABLE_NAME = "ingestion_projection.authenticated_notice_collector_run";

type InternalPortalRunSourceSurface = "notice" | "file_release";
type InternalPortalRunCollectionMode = NoticeCollectionMode | "file_release_export";

export function buildInternalPortalRunId(
	exportedAt: string,
	siteId: string,
	sourceSurface: InternalPortalRunSourceSurface,
): string {
	return `${siteId}:${sourceSurface}:${exportedAt.replace(/[^0-9A-Za-z]/g, "")}`;
}

export function buildInternalPortalRunStartedLedgerRecord(input: {
	collectionMode: InternalPortalRunCollectionMode;
	runId: string;
	siteId: string;
	sourceHomeUrl: string;
	sourceSurface: InternalPortalRunSourceSurface;
	startedAt: string;
}): InternalPortalRunLedgerRecord {
	return buildLifecycleLedgerRecord({
		...input,
		failureReason: null,
		finishedAt: null,
		status: "started",
	});
}

export function buildInternalPortalRunFailedLedgerRecord(input: {
	collectionMode: InternalPortalRunCollectionMode;
	failureReason: string;
	finishedAt: string;
	runId: string;
	siteId: string;
	sourceHomeUrl: string;
	sourceSurface: InternalPortalRunSourceSurface;
	startedAt: string;
}): InternalPortalRunLedgerRecord {
	return buildLifecycleLedgerRecord({
		...input,
		status: "failed",
	});
}

function buildLifecycleLedgerRecord(input: {
	collectionMode: InternalPortalRunCollectionMode;
	failureReason: string | null;
	finishedAt: string | null;
	runId: string;
	siteId: string;
	sourceHomeUrl: string;
	sourceSurface: InternalPortalRunSourceSurface;
	startedAt: string;
	status: "started" | "failed";
}): InternalPortalRunLedgerRecord {
	const record = {
		run_id: input.runId,
		site_id: input.siteId,
		source_surface: input.sourceSurface,
		collection_mode: input.collectionMode,
		source_home_url: input.sourceHomeUrl,
		notice_type_ids: [],
		selected_notice_ids: [],
		bundle_path: null,
		manifest_path: null,
		source_bucket: null,
		bundle_object_key: null,
		bundle_content_sha256: null,
		bundle_byte_size: null,
		manifest_object_key: null,
		manifest_content_sha256: null,
		manifest_byte_size: null,
		notices_collected: 0,
		pages_fetched: 0,
		detail_fetched: 0,
		items_seen: 0,
		attachment_refs_seen: 0,
		attachment_uploaded: 0,
		attachment_terminal_unavailable: 0,
		attachment_transient_failed: 0,
		attachment_reference_only: 0,
		status: input.status,
		verification_status: "missing_required_objects",
		required_source_object_count: 0,
		verified_source_object_count: 0,
		missing_source_object_count: 0,
		checksum_mismatch_count: 0,
		size_mismatch_count: 0,
		failure_reason: input.failureReason,
		error_count: input.status === "failed" ? 1 : 0,
		started_at: input.startedAt,
		finished_at: input.finishedAt,
	};
	return {
		runId: record.run_id,
		siteId: record.site_id,
		sourceSurface: input.sourceSurface,
		collectionMode: input.collectionMode,
		sourceHomeUrl: input.sourceHomeUrl,
		noticeTypeIds: [],
		selectedNoticeIds: [],
		bundlePath: null,
		manifestPath: null,
		sourceBucket: null,
		bundleObjectKey: null,
		bundleContentSha256: null,
		bundleByteSize: null,
		manifestObjectKey: null,
		manifestContentSha256: null,
		manifestByteSize: null,
		noticesCollected: 0,
		pagesFetched: 0,
		detailFetched: 0,
		itemsSeen: 0,
		attachmentRefsSeen: 0,
		attachmentUploaded: 0,
		attachmentTerminalUnavailable: 0,
		attachmentTransientFailed: 0,
		attachmentReferenceOnly: 0,
		status: input.status,
		verificationStatus: "missing_required_objects",
		requiredSourceObjectCount: 0,
		verifiedSourceObjectCount: 0,
		missingSourceObjectCount: 0,
		checksumMismatchCount: 0,
		sizeMismatchCount: 0,
		failureReason: input.failureReason,
		errorCount: record.error_count,
		startedAt: input.startedAt,
		finishedAt: input.finishedAt,
		record,
	};
}

export function buildInternalPortalRunLedgerRecord(input: {
	attachmentFetchAdmissions?: AttachmentFetchAdmission[];
	bundleArtifactRef?: StoredArtifactRef | null;
	bundleObjectKey?: string | null;
	bundlePath: string | null;
	bundleRecords: BundleNoticeRecord[];
	collectionMode: NoticeCollectionMode;
	exportedAt: string;
	manifest: NoticeExportManifest;
	manifestArtifactRef?: StoredArtifactRef | null;
	manifestObjectKey?: string | null;
	manifestPath: string | null;
	runId?: string;
	siteId: string;
	sourceHomeUrl: string;
}): InternalPortalRunLedgerRecord {
	const attachmentFacts = aggregateAttachmentFacts(input.bundleRecords);
	const requiredAttachmentFacts = aggregateRequiredNoticeAttachmentFacts({
		admissions: input.attachmentFetchAdmissions ?? [],
		bundleRecords: input.bundleRecords,
	});
	const selectedNoticeIds = input.manifest.filters.selected_notice_ids ?? [];
	const verification = buildVerificationSummary({
		bundleArtifactRef: input.bundleArtifactRef ?? null,
		manifestArtifactRef: input.manifestArtifactRef ?? null,
		requiredSourceByteObjectCount: requiredAttachmentFacts.requiredSourceByteObjectCount,
		verifiedSourceByteObjectCount: requiredAttachmentFacts.verifiedSourceByteObjectCount,
	});
	const record = {
		run_id: input.runId ?? buildInternalPortalRunId(input.exportedAt, input.siteId, "notice"),
		site_id: input.siteId,
		source_surface: "notice",
		collection_mode: input.collectionMode,
		source_home_url: input.sourceHomeUrl,
		notice_type_ids: input.manifest.filters.notice_types,
		selected_notice_ids: selectedNoticeIds,
		bundle_path: input.bundlePath,
		manifest_path: input.manifestPath,
		source_bucket: verification.sourceBucket,
		bundle_object_key: input.bundleArtifactRef?.objectKey ?? input.bundleObjectKey ?? null,
		bundle_content_sha256: input.bundleArtifactRef?.contentSha256 ?? null,
		bundle_byte_size: input.bundleArtifactRef?.byteSize ?? null,
		manifest_object_key: input.manifestArtifactRef?.objectKey ?? input.manifestObjectKey ?? null,
		manifest_content_sha256: input.manifestArtifactRef?.contentSha256 ?? null,
		manifest_byte_size: input.manifestArtifactRef?.byteSize ?? null,
		notices_collected: input.bundleRecords.length,
		pages_fetched: input.manifest.run.pages_fetched,
		detail_fetched: input.manifest.run.detail_fetched,
		items_seen: input.manifest.run.items_seen,
		attachment_refs_seen: attachmentFacts.attachmentRefsSeen,
		attachment_uploaded: attachmentFacts.attachmentUploaded,
		attachment_terminal_unavailable: attachmentFacts.attachmentTerminalUnavailable,
		attachment_transient_failed: attachmentFacts.attachmentTransientFailed,
		attachment_reference_only: attachmentFacts.attachmentReferenceOnly,
		status: verification.status,
		verification_status: verification.verificationStatus,
		required_source_object_count: verification.requiredSourceObjectCount,
		verified_source_object_count: verification.verifiedSourceObjectCount,
		missing_source_object_count: verification.missingSourceObjectCount,
		checksum_mismatch_count: verification.checksumMismatchCount,
		size_mismatch_count: verification.sizeMismatchCount,
		failure_reason: verification.failureReason,
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
		sourceBucket: verification.sourceBucket,
		bundleObjectKey: input.bundleArtifactRef?.objectKey ?? input.bundleObjectKey ?? null,
		bundleContentSha256: input.bundleArtifactRef?.contentSha256 ?? null,
		bundleByteSize: input.bundleArtifactRef?.byteSize ?? null,
		manifestObjectKey: input.manifestArtifactRef?.objectKey ?? input.manifestObjectKey ?? null,
		manifestContentSha256: input.manifestArtifactRef?.contentSha256 ?? null,
		manifestByteSize: input.manifestArtifactRef?.byteSize ?? null,
		noticesCollected: input.bundleRecords.length,
		pagesFetched: input.manifest.run.pages_fetched,
		detailFetched: input.manifest.run.detail_fetched,
		itemsSeen: input.manifest.run.items_seen,
		attachmentRefsSeen: attachmentFacts.attachmentRefsSeen,
		attachmentUploaded: attachmentFacts.attachmentUploaded,
		attachmentTerminalUnavailable: attachmentFacts.attachmentTerminalUnavailable,
		attachmentTransientFailed: attachmentFacts.attachmentTransientFailed,
		attachmentReferenceOnly: attachmentFacts.attachmentReferenceOnly,
		status: verification.status,
		verificationStatus: verification.verificationStatus,
		requiredSourceObjectCount: verification.requiredSourceObjectCount,
		verifiedSourceObjectCount: verification.verifiedSourceObjectCount,
		missingSourceObjectCount: verification.missingSourceObjectCount,
		checksumMismatchCount: verification.checksumMismatchCount,
		sizeMismatchCount: verification.sizeMismatchCount,
		failureReason: verification.failureReason,
		errorCount: input.manifest.run.errors,
		startedAt: input.manifest.run.started_at,
		finishedAt: input.manifest.run.finished_at,
		record,
	};
}

export function buildCollectorFileReleaseRunLedgerRecord(input: {
	bundleArtifactRef?: StoredArtifactRef | null;
	bundleObjectKey?: string | null;
	bundlePath: string | null;
	bundleRecords: BundleFileReleaseRecord[];
	exportedAt: string;
	manifest: FileReleaseExportManifest;
	manifestArtifactRef?: StoredArtifactRef | null;
	manifestObjectKey?: string | null;
	manifestPath: string | null;
	runId?: string;
	siteId: string;
	sourceHomeUrl: string;
}): InternalPortalRunLedgerRecord {
	const attachmentFacts = aggregateReleasedFileFacts(input.bundleRecords);
	const verification = buildVerificationSummary({
		bundleArtifactRef: input.bundleArtifactRef ?? null,
		manifestArtifactRef: input.manifestArtifactRef ?? null,
		requiredSourceByteObjectCount: attachmentFacts.sourceObjectsRequired,
		verifiedSourceByteObjectCount: attachmentFacts.attachmentUploaded,
	});
	const selectedFileReleaseIds =
		input.manifest.filters.target_file_release_id === null
			? []
			: [String(input.manifest.filters.target_file_release_id)];
	const record = {
		run_id: input.runId ?? buildInternalPortalRunId(input.exportedAt, input.siteId, "file_release"),
		site_id: input.siteId,
		source_surface: "file_release",
		collection_mode: "file_release_export",
		source_home_url: input.sourceHomeUrl,
		notice_type_ids: [],
		selected_notice_ids: selectedFileReleaseIds,
		bundle_path: input.bundlePath,
		manifest_path: input.manifestPath,
		source_bucket: verification.sourceBucket,
		bundle_object_key: input.bundleArtifactRef?.objectKey ?? input.bundleObjectKey ?? null,
		bundle_content_sha256: input.bundleArtifactRef?.contentSha256 ?? null,
		bundle_byte_size: input.bundleArtifactRef?.byteSize ?? null,
		manifest_object_key: input.manifestArtifactRef?.objectKey ?? input.manifestObjectKey ?? null,
		manifest_content_sha256: input.manifestArtifactRef?.contentSha256 ?? null,
		manifest_byte_size: input.manifestArtifactRef?.byteSize ?? null,
		notices_collected: input.bundleRecords.length,
		pages_fetched: input.manifest.run.pages_fetched,
		detail_fetched: input.manifest.run.detail_fetched,
		items_seen: input.manifest.run.items_seen,
		attachment_refs_seen: attachmentFacts.attachmentRefsSeen,
		attachment_uploaded: attachmentFacts.attachmentUploaded,
		attachment_terminal_unavailable: attachmentFacts.attachmentTerminalUnavailable,
		attachment_transient_failed: attachmentFacts.attachmentTransientFailed,
		attachment_reference_only: attachmentFacts.attachmentReferenceOnly,
		status: verification.status,
		verification_status: verification.verificationStatus,
		required_source_object_count: verification.requiredSourceObjectCount,
		verified_source_object_count: verification.verifiedSourceObjectCount,
		missing_source_object_count: verification.missingSourceObjectCount,
		checksum_mismatch_count: verification.checksumMismatchCount,
		size_mismatch_count: verification.sizeMismatchCount,
		failure_reason: verification.failureReason,
		error_count: input.manifest.run.errors,
		started_at: input.manifest.run.started_at,
		finished_at: input.manifest.run.finished_at,
		export_manifest: input.manifest,
	};
	return {
		runId: record.run_id,
		siteId: record.site_id,
		sourceSurface: "file_release",
		collectionMode: "file_release_export",
		sourceHomeUrl: input.sourceHomeUrl,
		noticeTypeIds: [],
		selectedNoticeIds: [...selectedFileReleaseIds],
		bundlePath: input.bundlePath,
		manifestPath: input.manifestPath,
		sourceBucket: verification.sourceBucket,
		bundleObjectKey: input.bundleArtifactRef?.objectKey ?? input.bundleObjectKey ?? null,
		bundleContentSha256: input.bundleArtifactRef?.contentSha256 ?? null,
		bundleByteSize: input.bundleArtifactRef?.byteSize ?? null,
		manifestObjectKey: input.manifestArtifactRef?.objectKey ?? input.manifestObjectKey ?? null,
		manifestContentSha256: input.manifestArtifactRef?.contentSha256 ?? null,
		manifestByteSize: input.manifestArtifactRef?.byteSize ?? null,
		noticesCollected: input.bundleRecords.length,
		pagesFetched: input.manifest.run.pages_fetched,
		detailFetched: input.manifest.run.detail_fetched,
		itemsSeen: input.manifest.run.items_seen,
		attachmentRefsSeen: attachmentFacts.attachmentRefsSeen,
		attachmentUploaded: attachmentFacts.attachmentUploaded,
		attachmentTerminalUnavailable: attachmentFacts.attachmentTerminalUnavailable,
		attachmentTransientFailed: attachmentFacts.attachmentTransientFailed,
		attachmentReferenceOnly: attachmentFacts.attachmentReferenceOnly,
		status: verification.status,
		verificationStatus: verification.verificationStatus,
		requiredSourceObjectCount: verification.requiredSourceObjectCount,
		verifiedSourceObjectCount: verification.verifiedSourceObjectCount,
		missingSourceObjectCount: verification.missingSourceObjectCount,
		checksumMismatchCount: verification.checksumMismatchCount,
		sizeMismatchCount: verification.sizeMismatchCount,
		failureReason: verification.failureReason,
		errorCount: input.manifest.run.errors,
		startedAt: input.manifest.run.started_at,
		finishedAt: input.manifest.run.finished_at,
		record,
	};
}

export function createInMemoryInternalPortalRunLedgerStore(): InternalPortalRunLedgerStore & {
	records(): InternalPortalRunLedgerRecord[];
} {
	const rows: InternalPortalRunLedgerRecord[] = [];
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

function buildVerificationSummary(input: {
	bundleArtifactRef: StoredArtifactRef | null;
	manifestArtifactRef: StoredArtifactRef | null;
	requiredSourceByteObjectCount: number;
	verifiedSourceByteObjectCount: number;
}): {
	checksumMismatchCount: number;
	failureReason: string | null;
	missingSourceObjectCount: number;
	requiredSourceObjectCount: number;
	sizeMismatchCount: number;
	sourceBucket: string | null;
	status: "success" | "failed";
	verificationStatus: "verified" | "missing_required_objects";
	verifiedSourceObjectCount: number;
} {
	const handoffRefs = [input.bundleArtifactRef, input.manifestArtifactRef].filter(
		(item): item is StoredArtifactRef => item !== null,
	);
	const requiredSourceObjectCount = 2 + input.requiredSourceByteObjectCount;
	const verifiedSourceObjectCount = handoffRefs.length + input.verifiedSourceByteObjectCount;
	const missingSourceObjectCount = requiredSourceObjectCount - verifiedSourceObjectCount;
	const sourceBucket = input.bundleArtifactRef?.bucket ?? input.manifestArtifactRef?.bucket ?? null;
	if (missingSourceObjectCount > 0) {
		return {
			checksumMismatchCount: 0,
			failureReason: "missing_required_objects",
			missingSourceObjectCount,
			requiredSourceObjectCount,
			sizeMismatchCount: 0,
			sourceBucket,
			status: "failed",
			verificationStatus: "missing_required_objects",
			verifiedSourceObjectCount,
		};
	}
	return {
		checksumMismatchCount: 0,
		failureReason: null,
		missingSourceObjectCount,
		requiredSourceObjectCount,
		sizeMismatchCount: 0,
		sourceBucket,
		status: "success",
		verificationStatus: "verified",
		verifiedSourceObjectCount,
	};
}

export function createPostgresInternalPortalRunLedgerStore(input: {
	databaseUrl: string;
	tableName?: string;
}): DisposableInternalPortalRunLedgerStore {
	const tableReference = resolveInternalPortalRunLedgerTableReference(
		input.tableName ?? DEFAULT_RUN_LEDGER_TABLE_NAME,
	);
	const pool = new Pool({ connectionString: input.databaseUrl });
	return {
		async upsertRun(record) {
			await ensureInternalPortalRunLedgerSchema(pool, tableReference);
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
						source_bucket,
						bundle_object_key,
						bundle_content_sha256,
						bundle_byte_size,
						manifest_object_key,
						manifest_content_sha256,
						manifest_byte_size,
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
						verification_status,
						required_source_object_count,
						verified_source_object_count,
						missing_source_object_count,
						checksum_mismatch_count,
						size_mismatch_count,
						failure_reason,
						error_count,
						started_at,
						finished_at,
					record
					) values (
						$1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
						$11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
						$21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
						$31, $32, $33, $34, $35, $36, $37
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
						source_bucket = excluded.source_bucket,
						bundle_object_key = excluded.bundle_object_key,
						bundle_content_sha256 = excluded.bundle_content_sha256,
						bundle_byte_size = excluded.bundle_byte_size,
						manifest_object_key = excluded.manifest_object_key,
						manifest_content_sha256 = excluded.manifest_content_sha256,
						manifest_byte_size = excluded.manifest_byte_size,
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
						verification_status = excluded.verification_status,
						required_source_object_count = excluded.required_source_object_count,
						verified_source_object_count = excluded.verified_source_object_count,
						missing_source_object_count = excluded.missing_source_object_count,
						checksum_mismatch_count = excluded.checksum_mismatch_count,
						size_mismatch_count = excluded.size_mismatch_count,
						failure_reason = excluded.failure_reason,
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
					record.sourceBucket,
					record.bundleObjectKey,
					record.bundleContentSha256,
					record.bundleByteSize,
					record.manifestObjectKey,
					record.manifestContentSha256,
					record.manifestByteSize,
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
					record.verificationStatus,
					record.requiredSourceObjectCount,
					record.verifiedSourceObjectCount,
					record.missingSourceObjectCount,
					record.checksumMismatchCount,
					record.sizeMismatchCount,
					record.failureReason,
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

async function ensureInternalPortalRunLedgerSchema(
	pool: Pool,
	tableReference: InternalPortalRunLedgerTableReference,
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
				bundle_path text,
				manifest_path text,
				source_bucket text,
				bundle_object_key text,
				bundle_content_sha256 text,
				bundle_byte_size bigint,
				manifest_object_key text,
				manifest_content_sha256 text,
				manifest_byte_size bigint,
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
				verification_status text not null default 'missing_required_objects',
				required_source_object_count integer not null default 0,
				verified_source_object_count integer not null default 0,
				missing_source_object_count integer not null default 0,
				checksum_mismatch_count integer not null default 0,
				size_mismatch_count integer not null default 0,
				failure_reason text,
				error_count integer not null,
			started_at timestamptz not null,
			finished_at timestamptz,
			record jsonb not null
			)
		`);
	await pool.query(`
		alter table ${tableReference.tableSql}
			add column if not exists source_bucket text,
			add column if not exists bundle_content_sha256 text,
			add column if not exists bundle_byte_size bigint,
			add column if not exists manifest_content_sha256 text,
			add column if not exists manifest_byte_size bigint,
			add column if not exists verification_status text not null default 'missing_required_objects',
			add column if not exists required_source_object_count integer not null default 0,
			add column if not exists verified_source_object_count integer not null default 0,
			add column if not exists missing_source_object_count integer not null default 0,
			add column if not exists checksum_mismatch_count integer not null default 0,
			add column if not exists size_mismatch_count integer not null default 0,
			add column if not exists failure_reason text
	`);
	await pool.query(`
		alter table ${tableReference.tableSql}
			alter column bundle_path drop not null,
			alter column manifest_path drop not null,
			alter column finished_at drop not null
	`);
}

export function resolveInternalPortalRunLedgerTableReference(
	tableName: string,
): InternalPortalRunLedgerTableReference {
	const parts = tableName.split(".");
	if (parts.length === 0 || parts.length > 2) {
		throw new Error(`invalid internal portal run ledger table name: ${tableName}`);
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
		throw new Error(`invalid internal portal run ledger table identifier: ${identifier}`);
	}
	return `"${identifier}"`;
}
