import fs from "node:fs";
import path from "node:path";
import { fetchNoticeDetail, fetchNoticePage, fetchNoticeSelects } from "./api";
import {
	type AuthenticatedNoticeArtifactStore,
	createAuthenticatedNoticeArtifactStoreFromEnv,
	type StoredArtifactRef,
} from "./artifact-store";
import { parseAttachmentFetchAdmissionsFromManifest } from "./attachment-fetch-admissions";
import type { AuthenticatedNoticeAttachmentFetchStatusStore } from "./attachment-fetch-status";
import {
	type AttachmentFetchAdmission,
	materializeBundleAttachments,
} from "./attachment-materialization";
import {
	buildCategories,
	buildExportManifest,
	buildNoticeBrowserUrls,
	buildReferenceArtifacts,
	mergeBundleRecord,
	normalizeNoticeType,
	normalizeNullableNumber,
	normalizeNullableText,
	normalizeObservedNoticeTypes,
	normalizeObservedOrganizations,
	normalizeOptionalNoticeId,
	normalizeRequiredNoticeId,
	normalizeRequiredText,
	toTimestampLabel,
} from "./bootstrap-export-helpers";
import {
	buildAttachmentFetchStatusStoreForMain,
	buildCollectorRunLeaseStoreForMain,
	buildCollectorRunLedgerStoreForMain,
} from "./bootstrap-export-runtime-stores";
import {
	buildCollectorRunLeaseKey,
	type DisposableCollectorRunLeaseStore,
	withCollectorRunLease,
} from "./collector-run-lease";
import {
	buildCollectorRunFailedLedgerRecord,
	buildCollectorRunId,
	buildCollectorRunLedgerRecord,
	buildCollectorRunStartedLedgerRecord,
	type CollectorRunLedgerRecord,
	type CollectorRunLedgerStore,
} from "./collector-run-ledger";
import {
	type CollectorConfig,
	ensureRuntimeDirs,
	loadCollectorEnv,
	resolveCollectorConfig,
} from "./config";
import { applyNoticeTypeAllowlist, getEnabledNoticeTypes, loadNoticeTypes } from "./notice-types";
import { createApiContextFromStorageState } from "./portal";
import { assertNoticeRunAdmissionAccepted, buildNoticeRunAdmission } from "./run-admission";
import { formatSafeErrorMessage } from "./safe-error";
import type {
	ApiRequestContextLike,
	BootstrapExportManifest,
	BundleNoticeRecord,
	DisposableApiContextLike,
	NoticeCollectionMode,
	NoticeDetailInfo,
	NoticeDetailResponse,
	NoticeItem,
	NoticeListResponse,
	NoticeSelectsResponse,
	NoticeTypeConfig,
} from "./types";

export interface CollectBootstrapBundleInput {
	attachmentArtifactStore?: AuthenticatedNoticeArtifactStore;
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
	requestBackoffBaseMs: number;
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

export interface CollectBootstrapBundleResult {
	bundleRecords: BundleNoticeRecord[];
	exportManifest: BootstrapExportManifest;
	stats: {
		attachmentObjectsUploaded: number;
		detailFetched: number;
		noticesCollected: number;
		pagesFetched: number;
	};
}

export { parseAttachmentFetchAdmissionsFromManifest } from "./attachment-fetch-admissions";

export interface WriteBootstrapArtifactsInput {
	bundleRecords: BundleNoticeRecord[];
	exportManifest: BootstrapExportManifest;
	outputDir: string;
}

export interface WriteBootstrapArtifactsResult {
	bundlePath: string;
	manifestPath: string;
}

export interface BootstrapArtifactObjectRefs {
	bundleByteSize: number;
	bundleContentSha256: string;
	bundleObjectKey: string;
	bundleRef: StoredArtifactRef;
	manifestByteSize: number;
	manifestContentSha256: string;
	manifestObjectKey: string;
	manifestRef: StoredArtifactRef;
	sourceBucket: string;
}

export interface UploadBootstrapArtifactsInput {
	artifactStore: AuthenticatedNoticeArtifactStore;
	bundleRecords: unknown[];
	exportedAt: string;
	exportManifest: unknown;
	siteId: string;
}

export interface RunBootstrapExportInput {
	artifactStore?: AuthenticatedNoticeArtifactStore;
	attachmentFetchAdmissions?: AttachmentFetchAdmission[];
	collectBundle: () => Promise<CollectBootstrapBundleResult>;
	collectionMode: NoticeCollectionMode;
	collectorRunLedgerStore?: CollectorRunLedgerStore;
	exportedAt: string;
	outputDir?: string;
	runId?: string;
	siteId: string;
	sourceHomeUrl: string;
	writeLocalArtifacts: boolean;
}

export interface RunBootstrapExportResult {
	ledgerRecord: CollectorRunLedgerRecord;
	result: CollectBootstrapBundleResult;
	uploadedArtifactRefs: BootstrapArtifactObjectRefs;
	written: WriteBootstrapArtifactsResult | null;
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

export async function collectBootstrapBundle(
	input: CollectBootstrapBundleInput,
): Promise<CollectBootstrapBundleResult> {
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
	const enabledNoticeTypes = getEnabledNoticeTypes(input.noticeTypes);
	const createApiContext =
		input.createApiContext ??
		(() => createApiContextFromStorageState(resolveCollectorConfig(process.env)));
	const apiContext = await createApiContext();
	const fetchPage =
		input.fetchNoticePage ??
		((pageInput) =>
			fetchNoticePage({
				...pageInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));
	const fetchSelects =
		input.fetchNoticeSelects ??
		((selectInput) =>
			fetchNoticeSelects({
				...selectInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));
	const fetchDetail =
		input.fetchNoticeDetail ??
		((detailInput) =>
			fetchNoticeDetail({
				...detailInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));

	const bundleMap = new Map<number, BundleNoticeRecord>();
	let detailFetched = 0;
	let itemsSeen = 0;
	let pagesFetched = 0;
	let pageBudgetExhausted = false;
	let observedNoticeTypes: Array<{ notice_type_id: number; notice_type_name: string }> = [];
	let observedOrganizations: Array<{ organization_id: string; organization_name: string }> = [];
	let materialized = {
		bundleRecords: [] as BundleNoticeRecord[],
		downloadedAttachmentCount: 0,
		uploadedAttachmentCount: 0,
	};

	try {
		const noticeSelects = await fetchSelects({
			apiContext,
			currentPage: 1,
			pageSize: 15,
		});
		observedNoticeTypes = normalizeObservedNoticeTypes(noticeSelects);
		observedOrganizations = normalizeObservedOrganizations(noticeSelects);
		if (selectedNotices.length > 0) {
			itemsSeen = selectedNotices.length;
			for (const selectedNotice of selectedNotices) {
				const detailResponse = await fetchDetail({
					apiContext,
					noticeId: selectedNotice.noticeId,
					noticeType: selectedNotice.noticeType,
				});
				detailFetched += 1;
				const detailInfo = detailResponse.datas?.notice_info;
				const record = buildBundleRecord({
					detailInfo,
					notice: {
						notice_id: selectedNotice.noticeId,
						notice_title: selectedNotice.noticeTitle ?? detailInfo?.notice_title ?? undefined,
						notice_type: selectedNotice.noticeType,
						notice_type_name:
							selectedNotice.noticeTypeName ??
							detailInfo?.notice_type_name ??
							findNoticeTypeName(input.noticeTypes, selectedNotice.noticeType) ??
							findObservedNoticeTypeName(observedNoticeTypes, selectedNotice.noticeType),
					},
					observedAt: input.exportedAt,
					sourceHomeUrl: input.sourceHomeUrl,
				});
				bundleMap.set(selectedNotice.noticeId, record);
			}
		} else {
			for (const noticeType of enabledNoticeTypes) {
				const pageBudget =
					collectionMode === "backfill"
						? (input.backfillMaxPagesPerType ?? noticeType.backfillPages)
						: noticeType.incrementalPages;
				const pageSize =
					collectionMode === "backfill"
						? noticeType.backfillPageSize
						: noticeType.incrementalPageSize;
				for (let currentPage = 1; currentPage <= pageBudget; currentPage += 1) {
					if (input.maxNotices && bundleMap.size >= input.maxNotices) {
						break;
					}

					const pageResponse = await fetchPage({
						apiContext,
						currentPage,
						noticeType: noticeType.type,
						pageSize,
					});
					pagesFetched += 1;

					const items = pageResponse.datas?.tables ?? [];
					itemsSeen += items.length;

					for (const item of items) {
						const noticeId = normalizeOptionalNoticeId(item.notice_id);
						if (noticeId === null) {
							continue;
						}
						const existing = bundleMap.get(noticeId);
						if (existing) {
							bundleMap.set(noticeId, mergeBundleRecord(existing, item, input.exportedAt));
							continue;
						}
						if (input.maxNotices && bundleMap.size >= input.maxNotices) {
							break;
						}
						const detailResponse = await fetchDetail({
							apiContext,
							noticeId,
							noticeType: normalizeNoticeType(item.notice_type ?? noticeType.type),
						});
						detailFetched += 1;
						bundleMap.set(
							noticeId,
							buildBundleRecord({
								detailInfo: detailResponse.datas?.notice_info,
								notice: item,
								observedAt: input.exportedAt,
								sourceHomeUrl: input.sourceHomeUrl,
							}),
						);
					}

					const totalCounts = pageResponse.datas?.page?.totalCounts;
					if (
						typeof totalCounts === "number" &&
						totalCounts > currentPage &&
						currentPage >= pageBudget
					) {
						pageBudgetExhausted = true;
					}
					if (typeof totalCounts === "number" && currentPage >= totalCounts) {
						break;
					}
				}

				if (input.maxNotices && bundleMap.size >= input.maxNotices) {
					break;
				}
			}
		}
		const bundleRecords = [...bundleMap.values()];
		materialized =
			input.attachmentArtifactStore === undefined
				? {
						bundleRecords,
						downloadedAttachmentCount: 0,
						uploadedAttachmentCount: 0,
					}
				: await materializeBundleAttachments({
						apiContext,
						artifactStore: input.attachmentArtifactStore,
						attachmentFetchAdmissions: input.attachmentFetchAdmissions,
						attachmentFetchStatusStore: input.attachmentFetchStatusStore,
						defaultInlineVisualCapture: input.defaultInlineVisualCapture,
						bundleRecords,
						observedAt: input.exportedAt,
						requestBackoffBaseMs: input.requestBackoffBaseMs,
						requestMaxRetries: input.requestMaxRetries,
						siteId: input.siteId,
					});
	} finally {
		await apiContext.dispose();
	}
	if (fullScopeRequested && pageBudgetExhausted) {
		throw new Error("page_budget_exhausted");
	}

	return {
		bundleRecords: materialized.bundleRecords,
		exportManifest: buildExportManifest({
			attachmentStorageMode:
				materialized.uploadedAttachmentCount > 0 ? "object_store_write" : "reference_only",
			collectionMode,
			detailFetched,
			exportedAt: input.exportedAt,
			fullScopeCompleted: fullScopeRequested && !pageBudgetExhausted,
			fullScopeRequested,
			itemsInserted: materialized.bundleRecords.length,
			itemsSeen,
			maxNotices: input.maxNotices ?? null,
			noticeTypes: input.noticeTypes,
			observedNoticeTypes,
			observedOrganizations,
			pageBudgetExhausted,
			pagesFetched,
			runAdmission,
			selectedNoticeIds: selectedNotices.map((item) => String(item.noticeId)),
			selectedNoticeTypes: normalizeNoticeTypes(selectedNotices.map((item) => item.noticeType)),
			siteId: input.siteId,
			sourceHomeUrl: input.sourceHomeUrl,
		}),
		stats: {
			attachmentObjectsUploaded: materialized.uploadedAttachmentCount,
			detailFetched,
			noticesCollected: materialized.bundleRecords.length,
			pagesFetched,
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
			throw new Error(
				"AUTHENTICATED_NOTICE_SELECTED_NOTICES entries must use notice_id:notice_type",
			);
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

function findNoticeTypeName(
	noticeTypes: NoticeTypeConfig[],
	noticeType: string,
): string | undefined {
	return noticeTypes.find((item) => item.type === noticeType)?.name;
}

function findObservedNoticeTypeName(
	noticeTypes: Array<{ notice_type_id: number; notice_type_name: string }>,
	noticeType: string,
): string | undefined {
	const parsed = Number(noticeType);
	if (!Number.isInteger(parsed)) {
		return;
	}
	return noticeTypes.find((item) => item.notice_type_id === parsed)?.notice_type_name;
}

function normalizeNoticeTypes(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function writeBootstrapArtifacts(
	input: WriteBootstrapArtifactsInput,
): WriteBootstrapArtifactsResult {
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

export async function uploadBootstrapArtifacts(
	input: UploadBootstrapArtifactsInput,
): Promise<BootstrapArtifactObjectRefs> {
	const prefix = [
		"authenticated_notice_portal",
		"runs",
		sanitizeObjectKeySegment(input.siteId),
		toTimestampLabel(input.exportedAt),
	].join("/");
	const bundleObjectKey = `${prefix}/notices-bundle.json`;
	const manifestObjectKey = `${prefix}/export-manifest.json`;
	const bundlePayload = serializeJsonArtifactPayload(input.bundleRecords);
	const manifestPayload = serializeJsonArtifactPayload(input.exportManifest);
	const bundleRef = await input.artifactStore.putObject({
		objectKey: bundleObjectKey,
		data: bundlePayload,
		contentType: "application/json",
		metadata: {
			artifact_kind: "notices_bundle",
			site_id: input.siteId,
			source_channel: "authenticated_notice_portal",
		},
	});
	const manifestRef = await input.artifactStore.putObject({
		objectKey: manifestObjectKey,
		data: manifestPayload,
		contentType: "application/json",
		metadata: {
			artifact_kind: "export_manifest",
			site_id: input.siteId,
			source_channel: "authenticated_notice_portal",
		},
	});
	return {
		bundleByteSize: bundleRef.byteSize,
		bundleContentSha256: bundleRef.contentSha256,
		bundleObjectKey,
		bundleRef,
		manifestByteSize: manifestRef.byteSize,
		manifestContentSha256: manifestRef.contentSha256,
		manifestObjectKey,
		manifestRef,
		sourceBucket: bundleRef.bucket,
	};
}

function serializeJsonArtifactPayload(value: unknown): Uint8Array {
	return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export async function runBootstrapExport(
	input: RunBootstrapExportInput,
): Promise<RunBootstrapExportResult> {
	const runId = input.runId ?? buildCollectorRunId(input.exportedAt, input.siteId, "notice");
	await input.collectorRunLedgerStore?.upsertRun(
		buildCollectorRunStartedLedgerRecord({
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
			? writeBootstrapArtifacts({
					bundleRecords: result.bundleRecords,
					exportManifest: result.exportManifest,
					outputDir: input.outputDir ?? process.cwd(),
				})
			: null;
		if (!input.artifactStore) {
			throw new Error("authenticated notice source-bucket artifact store is required");
		}
		const uploadedArtifactRefs = await uploadBootstrapArtifacts({
			artifactStore: input.artifactStore,
			bundleRecords: result.bundleRecords,
			exportedAt: input.exportedAt,
			exportManifest: result.exportManifest,
			siteId: input.siteId,
		});
		const ledgerRecord = buildCollectorRunLedgerRecord({
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
		await input.collectorRunLedgerStore?.upsertRun(ledgerRecord);
		terminalLedgerWritten = true;
		assertVerifiedRunHandoff(ledgerRecord);
		return {
			ledgerRecord,
			result,
			uploadedArtifactRefs,
			written,
		};
	} catch (error) {
		if (!terminalLedgerWritten) {
			await input.collectorRunLedgerStore?.upsertRun(
				buildCollectorRunFailedLedgerRecord({
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

function assertVerifiedRunHandoff(record: CollectorRunLedgerRecord): void {
	if (record.status !== "success" || record.verificationStatus !== "verified") {
		throw new Error(
			`collector handoff verification failed: ${record.failureReason ?? record.verificationStatus}`,
		);
	}
}

export async function main(): Promise<void> {
	loadCollectorEnv();
	const config = resolveCollectorConfig(process.env);
	ensureRuntimeDirs(config);
	const noticeTypes = applyNoticeTypeAllowlist(
		loadNoticeTypes(config.noticeTypesPath),
		config.noticeTypeAllowlist,
	);
	const exportedAt = new Date().toISOString();
	const attachmentArtifactStore = createAuthenticatedNoticeArtifactStoreFromEnv(process.env);
	const attachmentFetchAdmissions = loadAttachmentFetchAdmissionsForMain(config);
	const attachmentFetchStatusStore = buildAttachmentFetchStatusStoreForMain(config);
	const collectorRunLedgerStore = buildCollectorRunLedgerStoreForMain(config);
	const collectorRunLeaseStore = buildCollectorRunLeaseStoreForMain(config);
	try {
		await runWithOptionalCollectorLease(
			collectorRunLeaseStore,
			{
				leaseKey: buildCollectorRunLeaseKey({
					siteId: config.siteId,
					sourceSurface: "notice",
				}),
				now: exportedAt,
				ownerId: `${config.siteId}:notice:${toTimestampLabel(exportedAt)}`,
				ttlSeconds: config.collectorRunLeaseTtlSeconds,
			},
			async () => {
				const selectedNotices = parseSelectedNoticeSpecs(
					process.env.AUTHENTICATED_NOTICE_SELECTED_NOTICES,
				);
				const runResult = await runBootstrapExport({
					artifactStore: attachmentArtifactStore,
					attachmentFetchAdmissions,
					collectBundle: () =>
						collectBootstrapBundle({
							attachmentArtifactStore,
							attachmentFetchStatusStore,
							collectionMode: config.collectionMode,
							exportedAt,
							noticeTypes,
							requestBackoffBaseMs: config.requestBackoffBaseMs,
							requestMaxRetries: config.requestMaxRetries,
							attachmentFetchAdmissions,
							defaultInlineVisualCapture: config.defaultInlineVisualCapture,
							backfillMaxPagesPerType: config.historicalBackfillMaxPagesPerType,
							selectedNotices,
							siteId: config.siteId,
							sourceHomeUrl: config.sourceHomeUrl,
						}),
					collectionMode: config.collectionMode,
					collectorRunLedgerStore,
					exportedAt,
					outputDir: config.exportsDir,
					siteId: config.siteId,
					sourceHomeUrl: config.sourceHomeUrl,
					writeLocalArtifacts: config.writeLocalExports,
				});
				console.log(
					JSON.stringify(
						{
							...runResult.result.stats,
							bundlePath: runResult.written?.bundlePath ?? null,
							bundleObjectKey: runResult.uploadedArtifactRefs.bundleObjectKey,
							manifestPath: runResult.written?.manifestPath ?? null,
							manifestObjectKey: runResult.uploadedArtifactRefs.manifestObjectKey,
						},
						null,
						2,
					),
				);
			},
		);
	} finally {
		await attachmentFetchStatusStore?.dispose();
		await collectorRunLedgerStore?.dispose();
		await collectorRunLeaseStore?.dispose();
	}
}

function loadAttachmentFetchAdmissionsForMain(config: CollectorConfig): AttachmentFetchAdmission[] {
	if (config.attachmentFetchRequestManifestPath === null) {
		return [];
	}
	const raw = fs.readFileSync(config.attachmentFetchRequestManifestPath, "utf-8");
	return parseAttachmentFetchAdmissionsFromManifest(JSON.parse(raw));
}

function sanitizeObjectKeySegment(value: string): string {
	const normalized = value.trim().replace(/[^0-9A-Za-z_.=-]+/g, "_");
	return normalized || "unknown";
}

async function runWithOptionalCollectorLease<T>(
	store: DisposableCollectorRunLeaseStore | undefined,
	input: Parameters<typeof withCollectorRunLease>[1],
	operation: () => Promise<T>,
): Promise<T> {
	if (!store) {
		return await operation();
	}
	return await withCollectorRunLease(store, input, operation);
}
