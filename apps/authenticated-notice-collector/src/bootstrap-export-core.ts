import fs from "node:fs";
import path from "node:path";
import { fetchNoticeDetail, fetchNoticePage, fetchNoticeSelects } from "./api";
import {
	type AuthenticatedNoticeArtifactStore,
	createAuthenticatedNoticeArtifactStoreFromEnv,
} from "./artifact-store";
import { materializeBundleAttachments } from "./attachment-materialization";
import {
	buildCategories,
	buildExportManifest,
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
import { ensureRuntimeDirs, loadCollectorEnv, resolveCollectorConfig } from "./config";
import { getEnabledNoticeTypes, loadNoticeTypes } from "./notice-types";
import { createApiContextFromStorageState } from "./portal";
import type {
	ApiRequestContextLike,
	BootstrapExportManifest,
	BundleNoticeRecord,
	DisposableApiContextLike,
	NoticeDetailInfo,
	NoticeDetailResponse,
	NoticeItem,
	NoticeListResponse,
	NoticeSelectsResponse,
	NoticeTypeConfig,
} from "./types";

export interface CollectBootstrapBundleInput {
	attachmentArtifactStore?: AuthenticatedNoticeArtifactStore;
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
	noticeTypes: NoticeTypeConfig[];
	requestBackoffBaseMs: number;
	requestMaxRetries: number;
	siteId: string;
	sourceHomeUrl: string;
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

export interface WriteBootstrapArtifactsInput {
	bundleRecords: BundleNoticeRecord[];
	exportManifest: BootstrapExportManifest;
	outputDir: string;
}

export interface WriteBootstrapArtifactsResult {
	bundlePath: string;
	manifestPath: string;
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
			notice_create_time: normalizeNullableText(
				input.detailInfo?.notice_create_time ?? input.notice.notice_create_time,
			),
			notice_first_time: normalizeNullableText(
				input.detailInfo?.notice_first_time ?? input.notice.notice_first_time,
			),
			notice_id: noticeId,
			notice_link: normalizeNullableText(input.detailInfo?.notice_link ?? input.notice.notice_link),
			notice_link_state: normalizeNullableNumber(
				input.detailInfo?.notice_link_state ?? input.notice.notice_link_state,
			),
			notice_release_time: normalizeNullableText(
				input.detailInfo?.notice_release_time ?? input.notice.notice_release_time,
			),
			notice_source: normalizeNullableNumber(
				input.detailInfo?.notice_source ?? input.notice.notice_source,
			),
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
		},
		notice_attachments: artifacts.noticeAttachments,
		attachments: artifacts.attachments,
		links: artifacts.links,
	};
}

export async function collectBootstrapBundle(
	input: CollectBootstrapBundleInput,
): Promise<CollectBootstrapBundleResult> {
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
		for (const noticeType of input.noticeTypes) {
			for (let currentPage = 1; currentPage <= noticeType.incrementalPages; currentPage += 1) {
				if (input.maxNotices && bundleMap.size >= input.maxNotices) {
					break;
				}

				const pageResponse = await fetchPage({
					apiContext,
					currentPage,
					noticeType: noticeType.type,
					pageSize: noticeType.incrementalPageSize,
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
				if (typeof totalCounts === "number" && currentPage >= totalCounts) {
					break;
				}
			}

			if (input.maxNotices && bundleMap.size >= input.maxNotices) {
				break;
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
						bundleRecords,
						observedAt: input.exportedAt,
						requestBackoffBaseMs: input.requestBackoffBaseMs,
						requestMaxRetries: input.requestMaxRetries,
					});
	} finally {
		await apiContext.dispose();
	}

	return {
		bundleRecords: materialized.bundleRecords,
		exportManifest: buildExportManifest({
			attachmentStorageMode:
				input.attachmentArtifactStore === undefined ? "reference_only" : "object_store_write",
			detailFetched,
			exportedAt: input.exportedAt,
			itemsInserted: materialized.bundleRecords.length,
			itemsSeen,
			maxNotices: input.maxNotices ?? null,
			noticeTypes: input.noticeTypes,
			observedNoticeTypes,
			observedOrganizations,
			pagesFetched,
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

export async function main(): Promise<void> {
	loadCollectorEnv();
	const config = resolveCollectorConfig(process.env);
	ensureRuntimeDirs(config);
	const noticeTypes = getEnabledNoticeTypes(loadNoticeTypes(config.noticeTypesPath));
	const exportedAt = new Date().toISOString();
	const attachmentArtifactStore = createAuthenticatedNoticeArtifactStoreFromEnv(process.env);
	const result = await collectBootstrapBundle({
		attachmentArtifactStore,
		exportedAt,
		noticeTypes,
		requestBackoffBaseMs: config.requestBackoffBaseMs,
		requestMaxRetries: config.requestMaxRetries,
		siteId: config.siteId,
		sourceHomeUrl: config.sourceHomeUrl,
	});
	const written = writeBootstrapArtifacts({
		bundleRecords: result.bundleRecords,
		exportManifest: result.exportManifest,
		outputDir: config.exportsDir,
	});
	console.log(
		JSON.stringify(
			{
				...result.stats,
				bundlePath: written.bundlePath,
				manifestPath: written.manifestPath,
			},
			null,
			2,
		),
	);
}
