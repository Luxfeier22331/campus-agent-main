import fs from "node:fs";
import path from "node:path";
import { fetchNoticeDetail, fetchNoticePage, fetchNoticeSelects } from "./api.js";
import type { AuthenticatedNoticeArtifactStore, StoredArtifactRef } from "./artifact-store.js";

export { parseAttachmentFetchAdmissionsFromManifest } from "./attachment-fetch-admissions.js";

import { sanitizeObjectKeySegment } from "./artifact-keys.js";
import type { ExternalVisualFetcher } from "./attachment-crawlee-runner.js";
import type { AuthenticatedNoticeAttachmentFetchStatusStore } from "./attachment-fetch-status.js";
import {
	type AttachmentFetchAdmission,
	materializeBundleAttachments,
} from "./attachment-materialization.js";
import { resolveInternalPortalConfig } from "./config.js";
import {
	buildInternalPortalRunFailedLedgerRecord,
	buildInternalPortalRunId,
	buildInternalPortalRunLedgerRecord,
	buildInternalPortalRunStartedLedgerRecord,
	type InternalPortalRunLedgerRecord,
	type InternalPortalRunLedgerStore,
} from "./internal-portal-run-ledger.js";
import { runNoticeCrawleeCollection } from "./notice-crawlee-runner.js";
import {
	buildCategories,
	buildExportManifest,
	buildNoticeBrowserUrls,
	buildReferenceArtifacts,
	normalizeNoticeType,
	normalizeNullableNumber,
	normalizeNullableText,
	normalizeRequiredNoticeId,
	normalizeRequiredText,
	toTimestampLabel,
} from "./notice-export-helpers.js";
import { createApiContextFromStorageState } from "./portal.js";
import { assertNoticeRunAdmissionAccepted, buildNoticeRunAdmission } from "./run-admission.js";
import { formatSafeErrorMessage } from "./safe-error.js";
import type {
	ApiRequestContextLike,
	BundleNoticeRecord,
	DisposableApiContextLike,
	NoticeCollectionMode,
	NoticeDetailInfo,
	NoticeDetailResponse,
	NoticeExportManifest,
	NoticeItem,
	NoticeListResponse,
	NoticeSelectsResponse,
	NoticeTypeConfig,
} from "./types.js";

export interface CollectNoticeExportBundleInput {
	attachmentArtifactStore?: AuthenticatedNoticeArtifactStore;
	externalVisualFetcher?: ExternalVisualFetcher;
	attachmentFetchAdmissions?: AttachmentFetchAdmission[];
	attachmentFetchStatusStore?: AuthenticatedNoticeAttachmentFetchStatusStore;
	defaultInlineVisualCapture?: boolean;
	backfillMaxPagesPerType?: number | null;
	createApiContext?: () => Promise<ApiRequestContextLike & DisposableApiContextLike>;
	exportedAt: string;
	fetchNoticeDetail?: (input: {
		apiContext: ApiRequestContextLike;
		noticeId: number;
		noticeType: string;
	}) => Promise<NoticeDetailResponse>;
	fetchNoticePage?: (input: {
		apiContext: ApiRequestContextLike;
		currentPage: number;
		noticeType: string;
		pageSize: number;
	}) => Promise<NoticeListResponse>;
	fetchNoticeSelects?: (input: {
		apiContext: ApiRequestContextLike;
		currentPage: number;
		pageSize: number;
	}) => Promise<NoticeSelectsResponse>;
	maxNotices?: number;
	collectionMode?: NoticeCollectionMode;
	noticeTypes: NoticeTypeConfig[];
	requestMaxRetries: number;
	selectedNotices?: SelectedNoticeSpec[];
	siteId: string;
	sourceHomeUrl: string;
}

export interface SelectedNoticeSpec {
	noticeId: number;
	noticeType: string;
	noticeTypeName?: string;
	noticeTitle?: string;
}

export interface CollectNoticeExportBundleResult {
	bundleRecords: BundleNoticeRecord[];
	exportManifest: NoticeExportManifest;
	stats: {
		attachmentObjectsUploaded: number;
		detailFetched: number;
		noticesCollected: number;
		pagesFetched: number;
	};
}

export interface WriteNoticeExportArtifactsInput {
	bundleRecords: BundleNoticeRecord[];
	exportManifest: NoticeExportManifest;
	outputDir: string;
}

export interface WriteNoticeExportArtifactsResult {
	bundlePath: string;
	manifestPath: string;
}

export interface NoticeExportArtifactObjectRefs {
	bundleByteSize: number;
	bundleContentSha256: string;
	bundleObjectKey: string;
	bundleRef: StoredArtifactRef;
	captureReleaseByteSize: number;
	captureReleaseContentSha256: string;
	captureReleaseObjectKey: string;
	captureReleaseRef: StoredArtifactRef;
	manifestByteSize: number;
	manifestContentSha256: string;
	manifestObjectKey: string;
	manifestRef: StoredArtifactRef;
	sourceBucket: string;
}

export interface UploadNoticeExportArtifactsInput {
	artifactStore: AuthenticatedNoticeArtifactStore;
	bundleRecords: unknown[];
	exportedAt: string;
	exportManifest: unknown;
	siteId: string;
}

export interface RunNoticeExportInput {
	artifactStore?: AuthenticatedNoticeArtifactStore;
	attachmentFetchAdmissions?: AttachmentFetchAdmission[];
	collectBundle: () => Promise<CollectNoticeExportBundleResult>;
	collectionMode: NoticeCollectionMode;
	internalPortalRunLedgerStore?: InternalPortalRunLedgerStore;
	exportedAt: string;
	verifiedRunEnqueue?: (input: { ledgerRecord: InternalPortalRunLedgerRecord }) => Promise<void>;
	outputDir?: string;
	runId?: string;
	siteId: string;
	sourceHomeUrl: string;
	writeLocalArtifacts: boolean;
}

export interface RunNoticeExportResult {
	ledgerRecord: InternalPortalRunLedgerRecord;
	result: CollectNoticeExportBundleResult;
	uploadedArtifactRefs: NoticeExportArtifactObjectRefs;
	written: WriteNoticeExportArtifactsResult | null;
}

export function buildBundleRecord(input: {
	detailInfo: NoticeDetailInfo | null | undefined;
	notice: NoticeItem;
	observedAt: string;
	sourceHomeUrl?: string;
}): BundleNoticeRecord {
	const noticeId = normalizeRequiredNoticeId(input.notice.notice_id ?? input.detailInfo?.notice_id);
	const noticeTitle = normalizeRequiredText(
		input.notice.notice_title ?? input.detailInfo?.notice_title,
		"notice_title",
	);
	const sourceHomeUrl = normalizeNullableText(input.detailInfo?.home_url) ?? input.sourceHomeUrl;
	const noticeLink = normalizeNullableText(
		input.detailInfo?.notice_link ?? input.notice.notice_link,
	);
	const noticeLinkState = normalizeNullableNumber(
		input.detailInfo?.notice_link_state ?? input.notice.notice_link_state,
	);
	const noticeSource = normalizeNullableNumber(
		input.detailInfo?.notice_source ?? input.notice.notice_source,
	);
	const browserUrls = buildNoticeBrowserUrls({
		noticeId,
		noticeLink,
		noticeLinkState,
		noticeSource,
		noticeType: normalizeNoticeType(input.notice.notice_type),
		sourceHomeUrl,
	});
	const artifacts = buildReferenceArtifacts({
		htmlValue:
			normalizeNullableText(input.detailInfo?.notice_content ?? input.notice.notice_content) ?? "",
		noticeAnnexes: input.detailInfo?.notice_annext,
		noticeId,
		observedAt: input.observedAt,
		sourceHomeUrl,
	});
	return {
		notice_id: noticeId,
		notice: {
			categories: buildCategories({
				notice: input.notice,
				noticeId,
				observedAt: input.observedAt,
			}),
			enrich_attempted_at: input.observedAt,
			last_seen_at: input.observedAt,
			notice_content: normalizeNullableText(
				input.detailInfo?.notice_content ?? input.notice.notice_content,
			),
			notice_browser_url: browserUrls.notice_browser_url,
			notice_browser_url_source: browserUrls.notice_browser_url_source,
			notice_create_time: normalizeNullableText(
				input.detailInfo?.notice_create_time ?? input.notice.notice_create_time,
			),
			notice_first_time: normalizeNullableText(
				input.detailInfo?.notice_first_time ?? input.notice.notice_first_time,
			),
			notice_id: noticeId,
			notice_link: noticeLink,
			notice_link_state: noticeLinkState,
			notice_release_time: normalizeNullableText(
				input.detailInfo?.notice_release_time ?? input.notice.notice_release_time,
			),
			notice_source: noticeSource,
			notice_state: normalizeNullableNumber(
				input.detailInfo?.notice_state ?? input.notice.notice_state,
			),
			notice_stick: normalizeNullableNumber(
				input.detailInfo?.notice_stick ?? input.notice.notice_stick,
			),
			notice_title: noticeTitle,
			organization_id: normalizeNullableText(
				input.detailInfo?.organization_id ?? input.notice.organization_id,
			),
			organization_name: normalizeNullableText(
				input.detailInfo?.organization_name ?? input.notice.organization_name,
			),
			portal_print_url: browserUrls.portal_print_url,
		},
		notice_attachments: artifacts.noticeAttachments,
		attachments: artifacts.attachments,
		links: artifacts.links,
	};
}

export async function collectNoticeExportBundle(
	input: CollectNoticeExportBundleInput,
): Promise<CollectNoticeExportBundleResult> {
	const selectedNotices = normalizeSelectedNoticeSpecs(input.selectedNotices ?? []);
	const runAdmission = buildNoticeRunAdmission({
		backfillMaxPagesPerType: input.backfillMaxPagesPerType,
		collectionMode: input.collectionMode,
		noticeTypes: input.noticeTypes,
		selectedNotices,
	});
	assertNoticeRunAdmissionAccepted(runAdmission);
	const collectionMode = runAdmission.collection_mode;
	const fullScopeRequested =
		selectedNotices.length === 0 &&
		collectionMode === "backfill" &&
		(input.maxNotices ?? null) === null;
	const createApiContext =
		input.createApiContext ??
		(() => createApiContextFromStorageState(resolveInternalPortalConfig(process.env)));
	const apiContext = await createApiContext();
	const fetchPage = input.fetchNoticePage ?? ((pageInput) => fetchNoticePage({ ...pageInput }));
	const fetchSelects =
		input.fetchNoticeSelects ?? ((selectInput) => fetchNoticeSelects({ ...selectInput }));
	const fetchDetail =
		input.fetchNoticeDetail ?? ((detailInput) => fetchNoticeDetail({ ...detailInput }));

	let collected = {
		bundleRecords: [] as BundleNoticeRecord[],
		observedNoticeTypes: [] as Array<{ notice_type_id: number; notice_type_name: string }>,
		observedOrganizations: [] as Array<{ organization_id: string; organization_name: string }>,
		stats: {
			detailFetched: 0,
			itemsSeen: 0,
			pageBudgetExhausted: false,
			pagesFetched: 0,
		},
	};
	let materialized = {
		bundleRecords: [] as BundleNoticeRecord[],
		downloadedAttachmentCount: 0,
		uploadedAttachmentCount: 0,
	};

	try {
		collected = await runNoticeCrawleeCollection({
			apiContext,
			backfillMaxPagesPerType: input.backfillMaxPagesPerType ?? null,
			collectionMode,
			exportedAt: input.exportedAt,
			fetchNoticeDetail: fetchDetail,
			fetchNoticePage: fetchPage,
			fetchNoticeSelects: fetchSelects,
			fullScopeRequested,
			maxNotices: input.maxNotices ?? null,
			noticeTypes: input.noticeTypes,
			requestMaxRetries: input.requestMaxRetries,
			selectedNotices,
			siteId: input.siteId,
			sourceHomeUrl: input.sourceHomeUrl,
		});
		materialized =
			input.attachmentArtifactStore === undefined
				? {
						bundleRecords: collected.bundleRecords,
						downloadedAttachmentCount: 0,
						uploadedAttachmentCount: 0,
					}
				: await materializeBundleAttachments({
						apiContext,
						artifactStore: input.attachmentArtifactStore,
						attachmentFetchAdmissions: input.attachmentFetchAdmissions,
						attachmentFetchStatusStore: input.attachmentFetchStatusStore,
						defaultInlineVisualCapture: input.defaultInlineVisualCapture,
						externalVisualFetcher: input.externalVisualFetcher,
						bundleRecords: collected.bundleRecords,
						observedAt: input.exportedAt,
						requestMaxRetries: input.requestMaxRetries,
						siteId: input.siteId,
					});
	} finally {
		await apiContext.dispose();
	}
	if (fullScopeRequested && collected.stats.pageBudgetExhausted) {
		throw new Error("page_budget_exhausted");
	}

	return {
		bundleRecords: materialized.bundleRecords,
		exportManifest: buildExportManifest({
			attachmentStorageMode:
				materialized.uploadedAttachmentCount > 0 ? "object_store_write" : "reference_only",
			collectionMode,
			detailFetched: collected.stats.detailFetched,
			exportedAt: input.exportedAt,
			fullScopeCompleted: fullScopeRequested && !collected.stats.pageBudgetExhausted,
			fullScopeRequested,
			itemsInserted: materialized.bundleRecords.length,
			itemsSeen: collected.stats.itemsSeen,
			maxNotices: input.maxNotices ?? null,
			noticeTypes: input.noticeTypes,
			observedNoticeTypes: collected.observedNoticeTypes,
			observedOrganizations: collected.observedOrganizations,
			pageBudgetExhausted: collected.stats.pageBudgetExhausted,
			pagesFetched: collected.stats.pagesFetched,
			runAdmission,
			selectedNoticeIds: selectedNotices.map((item) => String(item.noticeId)),
			selectedNoticeTypes: normalizeNoticeTypes(selectedNotices.map((item) => item.noticeType)),
			siteId: input.siteId,
			sourceHomeUrl: input.sourceHomeUrl,
		}),
		stats: {
			attachmentObjectsUploaded: materialized.uploadedAttachmentCount,
			detailFetched: collected.stats.detailFetched,
			noticesCollected: materialized.bundleRecords.length,
			pagesFetched: collected.stats.pagesFetched,
		},
	};
}

export function parseSelectedNoticeSpecs(raw: string | undefined): SelectedNoticeSpec[] {
	const normalized = String(raw ?? "").trim();
	if (!normalized) {
		return [];
	}
	const specs: SelectedNoticeSpec[] = [];
	for (const token of normalized.split(",")) {
		const parts = token
			.split(":")
			.map((part) => part.trim())
			.filter(Boolean);
		if (parts.length < 2) {
			throw new Error("INTERNAL_PORTAL_SELECTED_NOTICES entries must use notice_id:notice_type");
		}
		const noticeId = Number(parts[0]);
		if (!Number.isInteger(noticeId) || noticeId <= 0) {
			throw new Error(`invalid selected notice id: ${parts[0]}`);
		}
		specs.push({
			noticeId,
			noticeType: parts[1],
			noticeTypeName: parts[2],
		});
	}
	return normalizeSelectedNoticeSpecs(specs);
}

function normalizeSelectedNoticeSpecs(specs: SelectedNoticeSpec[]): SelectedNoticeSpec[] {
	const normalized: SelectedNoticeSpec[] = [];
	const seen = new Set<string>();
	for (const spec of specs) {
		const noticeId = Number(spec.noticeId);
		const noticeType = String(spec.noticeType || "").trim();
		if (!Number.isInteger(noticeId) || noticeId <= 0 || !noticeType) {
			continue;
		}
		const key = `${noticeId}:${noticeType}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		normalized.push({
			noticeId,
			noticeType,
			noticeTypeName: normalizeNullableText(spec.noticeTypeName) ?? undefined,
			noticeTitle: normalizeNullableText(spec.noticeTitle) ?? undefined,
		});
	}
	return normalized;
}

function normalizeNoticeTypes(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function writeNoticeExportArtifacts(
	input: WriteNoticeExportArtifactsInput,
): WriteNoticeExportArtifactsResult {
	fs.mkdirSync(input.outputDir, { recursive: true });
	const timestamp = toTimestampLabel(input.exportManifest.exported_at);
	const bundlePath = path.join(input.outputDir, `notices-bundle-${timestamp}.json`);
	const manifestPath = path.join(input.outputDir, `export-manifest-${timestamp}.json`);

	fs.writeFileSync(bundlePath, `${JSON.stringify(input.bundleRecords, null, 2)}\n`, "utf-8");
	fs.writeFileSync(manifestPath, `${JSON.stringify(input.exportManifest, null, 2)}\n`, "utf-8");

	return {
		bundlePath,
		manifestPath,
	};
}

export async function uploadNoticeExportArtifacts(
	input: UploadNoticeExportArtifactsInput,
): Promise<NoticeExportArtifactObjectRefs> {
	const prefix = [
		"internal_portal",
		"runs",
		sanitizeObjectKeySegment(input.siteId),
		toTimestampLabel(input.exportedAt),
	].join("/");
	const bundleObjectKey = `${prefix}/notices-bundle.json`;
	const manifestObjectKey = `${prefix}/export-manifest.json`;
	const captureReleaseObjectKey = `${prefix}/capture-release.json`;
	const bundlePayload = serializeJsonArtifactPayload(input.bundleRecords);
	const manifestPayload = serializeJsonArtifactPayload(input.exportManifest);
	const bundleRef = await input.artifactStore.putObject({
		objectKey: bundleObjectKey,
		data: bundlePayload,
		contentType: "application/json",
		metadata: {
			artifact_kind: "notices_bundle",
			site_id: input.siteId,
			source_channel: "internal_portal",
		},
	});
	const manifestRef = await input.artifactStore.putObject({
		objectKey: manifestObjectKey,
		data: manifestPayload,
		contentType: "application/json",
		metadata: {
			artifact_kind: "export_manifest",
			site_id: input.siteId,
			source_channel: "internal_portal",
		},
	});
	const captureReleasePayload = serializeJsonArtifactPayload(
		buildAuthenticatedNoticeCaptureRelease({
			bundleRef,
			exportedAt: input.exportedAt,
			manifestRef,
			siteId: input.siteId,
		}),
	);
	const captureReleaseRef = await input.artifactStore.putObject({
		objectKey: captureReleaseObjectKey,
		data: captureReleasePayload,
		contentType: "application/json",
		metadata: {
			artifact_kind: "capture_release",
			site_id: input.siteId,
			source_channel: "internal_portal",
		},
	});
	return {
		bundleByteSize: bundleRef.byteSize,
		bundleContentSha256: bundleRef.contentSha256,
		bundleObjectKey,
		bundleRef,
		captureReleaseByteSize: captureReleaseRef.byteSize,
		captureReleaseContentSha256: captureReleaseRef.contentSha256,
		captureReleaseObjectKey,
		captureReleaseRef,
		manifestByteSize: manifestRef.byteSize,
		manifestContentSha256: manifestRef.contentSha256,
		manifestObjectKey,
		manifestRef,
		sourceBucket: bundleRef.bucket,
	};
}

function buildAuthenticatedNoticeCaptureRelease(input: {
	bundleRef: StoredArtifactRef;
	exportedAt: string;
	manifestRef: StoredArtifactRef;
	siteId: string;
}): Record<string, unknown> {
	const timestamp = toTimestampLabel(input.exportedAt);
	const bundleRef = sourceObjectRef("notices_bundle", input.bundleRef);
	const exportManifestRef = sourceObjectRef("export_manifest", input.manifestRef);
	return {
		schema_version: "authenticated_notice_capture_release.v1",
		source_channel: "internal_portal",
		source_surface: "notice",
		site_id: input.siteId,
		capture_id: `capture:${input.siteId}:notice:${timestamp}`,
		exported_at: input.exportedAt,
		bundle_ref: withoutRole(bundleRef),
		export_manifest_ref: withoutRole(exportManifestRef),
		source_object_refs: [bundleRef, exportManifestRef],
	};
}

function sourceObjectRef(role: string, ref: StoredArtifactRef): Record<string, unknown> {
	return {
		role,
		bucket: ref.bucket,
		key: ref.objectKey,
		content_sha256: ref.contentSha256,
		byte_size: ref.byteSize,
	};
}

function withoutRole(ref: Record<string, unknown>): Record<string, unknown> {
	const result = { ...ref };
	delete result.role;
	return result;
}

function serializeJsonArtifactPayload(value: unknown): Uint8Array {
	return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export async function runNoticeExport(input: RunNoticeExportInput): Promise<RunNoticeExportResult> {
	const runId = input.runId ?? buildInternalPortalRunId(input.exportedAt, input.siteId, "notice");
	await input.internalPortalRunLedgerStore?.upsertRun(
		buildInternalPortalRunStartedLedgerRecord({
			collectionMode: input.collectionMode,
			runId,
			siteId: input.siteId,
			sourceHomeUrl: input.sourceHomeUrl,
			sourceSurface: "notice",
			startedAt: input.exportedAt,
		}),
	);
	let terminalLedgerWritten = false;
	try {
		const result = await input.collectBundle();
		const written = input.writeLocalArtifacts
			? writeNoticeExportArtifacts({
					bundleRecords: result.bundleRecords,
					exportManifest: result.exportManifest,
					outputDir: input.outputDir ?? process.cwd(),
				})
			: null;
		if (!input.artifactStore) {
			throw new Error("authenticated notice source-bucket artifact store is required");
		}
		const uploadedArtifactRefs = await uploadNoticeExportArtifacts({
			artifactStore: input.artifactStore,
			bundleRecords: result.bundleRecords,
			exportedAt: input.exportedAt,
			exportManifest: result.exportManifest,
			siteId: input.siteId,
		});
		const ledgerRecord = buildInternalPortalRunLedgerRecord({
			attachmentFetchAdmissions: input.attachmentFetchAdmissions,
			bundleArtifactRef: uploadedArtifactRefs.bundleRef,
			bundleObjectKey: uploadedArtifactRefs.bundleObjectKey,
			bundlePath: written?.bundlePath ?? null,
			bundleRecords: result.bundleRecords,
			collectionMode: result.exportManifest.run.mode,
			exportedAt: input.exportedAt,
			manifest: result.exportManifest,
			manifestArtifactRef: uploadedArtifactRefs.manifestRef,
			manifestObjectKey: uploadedArtifactRefs.manifestObjectKey,
			manifestPath: written?.manifestPath ?? null,
			runId,
			siteId: input.siteId,
			sourceHomeUrl: input.sourceHomeUrl,
		});
		await input.internalPortalRunLedgerStore?.upsertRun(ledgerRecord);
		terminalLedgerWritten = true;
		assertVerifiedRunHandoff(ledgerRecord);
		await input.verifiedRunEnqueue?.({ ledgerRecord });
		return {
			ledgerRecord,
			result,
			uploadedArtifactRefs,
			written,
		};
	} catch (error) {
		if (!terminalLedgerWritten) {
			await input.internalPortalRunLedgerStore?.upsertRun(
				buildInternalPortalRunFailedLedgerRecord({
					collectionMode: input.collectionMode,
					failureReason: formatSafeErrorMessage(error),
					finishedAt: new Date().toISOString(),
					runId,
					siteId: input.siteId,
					sourceHomeUrl: input.sourceHomeUrl,
					sourceSurface: "notice",
					startedAt: input.exportedAt,
				}),
			);
		}
		throw error;
	}
}

function assertVerifiedRunHandoff(record: InternalPortalRunLedgerRecord): void {
	if (record.status !== "success" || record.verificationStatus !== "verified") {
		throw new Error(
			`internal portal handoff verification failed: ${record.failureReason ?? record.verificationStatus}`,
		);
	}
}
