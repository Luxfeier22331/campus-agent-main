import { encodeObjectKeySegment, sha256Hex } from "ingest-core";

import {
	type FetchAttachmentBinaryResult,
	fetchFileReleaseCodeTypes,
	fetchFileReleaseDetail,
	fetchFileReleaseDownloadUrl,
	fetchFileReleaseExplainDepartments,
	fetchFileReleasePage,
	fetchFileReleaseTypes,
	isAttachmentDownloadTerminalUnavailableError,
} from "./api.js";
import { bindApiContextCancellation } from "./api-context-cancellation.js";
import type { AuthenticatedNoticeArtifactStore, StoredArtifactRef } from "./artifact-store.js";
import {
	type AttachmentDownloadOutcome,
	runAttachmentCrawleeDownloadOutcomes,
} from "./attachment-crawlee-runner.js";
import { resolveInternalPortalConfig } from "./config.js";
import { runFileReleaseCrawleeCollection } from "./file-release-crawlee-runner.js";
import {
	buildExportManifest,
	classifyOriginScope,
	INTERNAL_PORTAL_SOURCE_CHANNEL,
	inferYearLabel,
	normalizeNullableNumber,
	normalizeNullableText,
	normalizeRequiredId,
	normalizeRequiredText,
	normalizeUrlHost,
	normalizeUrlScheme,
	resolveAbsoluteUrl,
	resolveFileReleaseFilename,
	resolveReleasedFileContentType,
	safeBasename,
} from "./file-release-export-helpers.js";
import { createPortalApiContext } from "./portal.js";
import type {
	ApiRequestContextLike,
	BundleFileReleaseRecord,
	DisposableApiContextLike,
	FileReleaseCodeTypeListResponse,
	FileReleaseDetailResponse,
	FileReleaseExplainDepartmentListResponse,
	FileReleaseExportManifest,
	FileReleaseListItem,
	FileReleasePageResponse,
	FileReleaseTypeListResponse,
} from "./types.js";

export interface CollectFileReleaseBundleInput {
	abortSignal?: AbortSignal;
	attachmentArtifactStore?: AuthenticatedNoticeArtifactStore;
	createApiContext?: () => Promise<ApiRequestContextLike & DisposableApiContextLike>;
	exportedAt: string;
	fetchFileReleaseDetail?: (input: {
		apiContext: ApiRequestContextLike;
		fileReleaseId: number;
	}) => Promise<FileReleaseDetailResponse>;
	fetchFileReleaseDownloadUrl?: (input: {
		apiContext: ApiRequestContextLike;
		fileReleaseId: number;
	}) => Promise<{ state?: boolean; url?: string | null }>;
	fetchFileReleasePage?: (input: {
		apiContext: ApiRequestContextLike;
		currentPage: number;
		pageSize: number;
	}) => Promise<FileReleasePageResponse>;
	fetchFileReleaseCodeTypes?: (input: {
		apiContext: ApiRequestContextLike;
	}) => Promise<FileReleaseCodeTypeListResponse>;
	fetchFileReleaseExplainDepartments?: (input: {
		apiContext: ApiRequestContextLike;
	}) => Promise<FileReleaseExplainDepartmentListResponse>;
	fetchFileReleaseTypes?: (input: {
		apiContext: ApiRequestContextLike;
	}) => Promise<FileReleaseTypeListResponse>;
	maxFileReleases?: number | null;
	maxPages?: number | null;
	pageSize: number;
	requestMaxRetries: number;
	siteId: string;
	sourceHomeUrl: string;
	targetFileReleaseId?: number | null;
}

export interface CollectFileReleaseBundleResult {
	bundleRecords: BundleFileReleaseRecord[];
	exportManifest: FileReleaseExportManifest;
	stats: {
		detailFetched: number;
		fileUrlsResolved: number;
		fileReleasesCollected: number;
		fileObjectsUploaded: number;
		pagesFetched: number;
	};
}

export interface UploadFileReleaseArtifactsInput {
	abortSignal?: AbortSignal;
	activityAttempt: number;
	artifactStore: AuthenticatedNoticeArtifactStore;
	bundleRecords: unknown[];
	exportedAt: string;
	exportManifest: unknown;
	runId: string;
	siteId: string;
}

export interface UploadFileReleaseArtifactsResult {
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

export function buildFileReleaseRecord(input: {
	detail: FileReleaseDetailResponse;
	downloadUrl: string | null;
	fileTypeNameById: Map<number, string>;
	item: FileReleaseListItem;
	observedAt: string;
	sourceHomeUrl: string;
}): BundleFileReleaseRecord {
	const fileReleaseId = normalizeRequiredId(input.item.id ?? input.detail.id, "file_release_id");
	const filename = normalizeRequiredText(input.item.filename ?? input.detail.filename, "filename");
	const fileTypeId = normalizeNullableNumber(input.detail.filetypeid);
	const fileTypeName =
		(fileTypeId === null ? null : input.fileTypeNameById.get(fileTypeId)) ??
		normalizeNullableText(input.item.typename);
	const originalPortalFileUrl = normalizeNullableText(input.detail.fileurl ?? input.item.fileurl);
	const resolvedDownloadUrl = resolveAbsoluteUrl(
		normalizeNullableText(input.downloadUrl) ?? originalPortalFileUrl,
		input.sourceHomeUrl,
	);
	if (!resolvedDownloadUrl) {
		throw new Error(`file release ${fileReleaseId} missing downloadable url`);
	}
	const originalFilename =
		normalizeNullableText(input.detail.upfilename) ?? safeBasename(resolvedDownloadUrl);

	return {
		file_release_id: fileReleaseId,
		file_release: {
			source_surface: "file_release",
			filename,
			filecode: normalizeNullableText(input.detail.filecode ?? input.item.filecode),
			filetime: normalizeNullableText(input.detail.filetime ?? input.item.filetime),
			filedepartment: normalizeNullableText(
				input.detail.filedepartment ?? input.item.filedepartment,
			),
			explain_department: normalizeNullableText(input.detail.explainDept ?? input.item.explainDept),
			publisher_user_name: normalizeNullableText(input.item.user_name),
			file_type_id: fileTypeId,
			file_type_name: fileTypeName,
			original_portal_file_url: originalPortalFileUrl,
			resolved_download_url: resolvedDownloadUrl,
			upfilename: originalFilename,
			important: normalizeNullableNumber(input.detail.important),
			det_important: normalizeNullableNumber(input.detail.detImportant),
			role: normalizeNullableNumber(input.detail.role),
			last_seen_at: input.observedAt,
			enrich_attempted_at: input.observedAt,
		},
		released_file: {
			source_url: resolvedDownloadUrl,
			normalized_source_url: resolvedDownloadUrl,
			final_url: resolvedDownloadUrl,
			original_filename: originalFilename,
			mime_type: null,
			byte_size: null,
			sha256: null,
			storage_provider: "reference_only",
			bucket: null,
			object_key: null,
			etag: null,
			version_id: null,
			origin_url_scheme: normalizeUrlScheme(resolvedDownloadUrl),
			origin_host: normalizeUrlHost(resolvedDownloadUrl),
			origin_scope: classifyOriginScope(resolvedDownloadUrl, input.sourceHomeUrl),
			provenance_status: "reference_only",
			ingest_status: "reference_only",
			local_path: null,
			downloaded_at: null,
			uploaded_at: null,
			last_error: null,
			created_at: input.observedAt,
			updated_at: input.observedAt,
		},
	};
}

export async function collectFileReleaseBundle(
	input: CollectFileReleaseBundleInput,
): Promise<CollectFileReleaseBundleResult> {
	input.abortSignal?.throwIfAborted();
	const createApiContext =
		input.createApiContext ??
		(() => createPortalApiContext(resolveInternalPortalConfig(process.env)));
	const apiContext = await createApiContext();
	const disposeApiContext = bindApiContextCancellation(apiContext, input.abortSignal);
	const fetchPage =
		input.fetchFileReleasePage ?? ((pageInput) => fetchFileReleasePage({ ...pageInput }));
	const fetchDetail =
		input.fetchFileReleaseDetail ?? ((detailInput) => fetchFileReleaseDetail({ ...detailInput }));
	const fetchDownloadUrl =
		input.fetchFileReleaseDownloadUrl ??
		((detailInput) => fetchFileReleaseDownloadUrl({ ...detailInput }));
	const fetchTypes =
		input.fetchFileReleaseTypes ?? ((typeInput) => fetchFileReleaseTypes({ ...typeInput }));
	const fetchCodeTypes =
		input.fetchFileReleaseCodeTypes ?? ((typeInput) => fetchFileReleaseCodeTypes({ ...typeInput }));
	const fetchExplainDepartments =
		input.fetchFileReleaseExplainDepartments ??
		((deptInput) => fetchFileReleaseExplainDepartments({ ...deptInput }));

	const targetFileReleaseId = input.targetFileReleaseId ?? null;

	try {
		input.abortSignal?.throwIfAborted();
		const collected = await runFileReleaseCrawleeCollection({
			abortSignal: input.abortSignal,
			apiContext,
			exportedAt: input.exportedAt,
			fetchFileReleaseCodeTypes: fetchCodeTypes,
			fetchFileReleaseDetail: fetchDetail,
			fetchFileReleaseDownloadUrl: fetchDownloadUrl,
			fetchFileReleaseExplainDepartments: fetchExplainDepartments,
			fetchFileReleasePage: fetchPage,
			fetchFileReleaseTypes: fetchTypes,
			maxFileReleases: input.maxFileReleases ?? null,
			maxPages: input.maxPages ?? null,
			pageSize: input.pageSize,
			requestMaxRetries: input.requestMaxRetries,
			siteId: input.siteId,
			targetFileReleaseId,
		});
		const fileTypeNameById = new Map(
			collected.observedFileTypes.map((item) => [item.id, item.typename]),
		);
		const bundleRecords = collected.collectedReleases.map((release) =>
			buildFileReleaseRecord({
				detail: release.detail,
				downloadUrl: release.downloadUrl,
				fileTypeNameById,
				item: release.item,
				observedAt: input.exportedAt,
				sourceHomeUrl: input.sourceHomeUrl,
			}),
		);
		const materialized =
			input.attachmentArtifactStore === undefined
				? {
						bundleRecords,
						uploadedCount: 0,
					}
				: await materializeReleasedFiles({
						abortSignal: input.abortSignal,
						apiContext,
						artifactStore: input.attachmentArtifactStore,
						bundleRecords,
						observedAt: input.exportedAt,
						requestMaxRetries: input.requestMaxRetries,
						siteId: input.siteId,
					});

		return {
			bundleRecords: materialized.bundleRecords,
			exportManifest: buildExportManifest({
				exportedAt: input.exportedAt,
				detailFetched: collected.stats.detailFetched,
				fileUrlsResolved: collected.stats.fileUrlsResolved,
				itemsInserted: materialized.bundleRecords.length,
				itemsSeen: collected.stats.itemsSeen,
				maxFileReleases: input.maxFileReleases ?? null,
				maxPages: input.maxPages ?? null,
				observedExplainDepartments: collected.observedExplainDepartments,
				observedFileCodeTypes: collected.observedFileCodeTypes,
				observedDepartments: collected.observedDepartments,
				observedFileTypes: collected.observedFileTypes,
				pageSize: input.pageSize,
				pagesFetched: collected.stats.pagesFetched,
				siteId: input.siteId,
				sourceHomeUrl: input.sourceHomeUrl,
				targetFileReleaseId,
				fileStorageMode:
					input.attachmentArtifactStore === undefined ? "reference_only" : "object_store_write",
			}),
			stats: {
				detailFetched: collected.stats.detailFetched,
				fileUrlsResolved: collected.stats.fileUrlsResolved,
				fileReleasesCollected: materialized.bundleRecords.length,
				fileObjectsUploaded: materialized.uploadedCount,
				pagesFetched: collected.stats.pagesFetched,
			},
		};
	} finally {
		await disposeApiContext();
	}
}

export async function uploadFileReleaseArtifacts(
	input: UploadFileReleaseArtifactsInput,
): Promise<UploadFileReleaseArtifactsResult> {
	input.abortSignal?.throwIfAborted();
	if (!Number.isSafeInteger(input.activityAttempt) || input.activityAttempt <= 0) {
		throw new Error("activityAttempt must be a positive integer");
	}
	const prefix = [
		INTERNAL_PORTAL_SOURCE_CHANNEL,
		encodeObjectKeySegment(input.siteId),
		"runs",
		encodeObjectKeySegment(input.runId),
		"attempts",
		String(input.activityAttempt),
		"file-release",
	].join("/");
	const bundleObjectKey = `${prefix}/file-releases-bundle.json`;
	const manifestObjectKey = `${prefix}/file-releases-manifest.json`;
	const bundlePayload = serializeJsonArtifactPayload(input.bundleRecords);
	const manifestPayload = serializeJsonArtifactPayload(input.exportManifest);
	const bundleRef = await input.artifactStore.createOrVerifyObject({
		abortSignal: input.abortSignal,
		objectKey: bundleObjectKey,
		data: bundlePayload,
		contentType: "application/json",
		metadata: {
			artifact_kind: "file_release_bundle",
			site_id: input.siteId,
			source_channel: INTERNAL_PORTAL_SOURCE_CHANNEL,
			source_surface: "file_release",
		},
	});
	input.abortSignal?.throwIfAborted();
	const manifestRef = await input.artifactStore.createOrVerifyObject({
		abortSignal: input.abortSignal,
		objectKey: manifestObjectKey,
		data: manifestPayload,
		contentType: "application/json",
		metadata: {
			artifact_kind: "file_release_manifest",
			site_id: input.siteId,
			source_channel: INTERNAL_PORTAL_SOURCE_CHANNEL,
			source_surface: "file_release",
		},
	});
	input.abortSignal?.throwIfAborted();
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

export function buildAuthenticatedNoticeFileReleaseCaptureKey(input: {
	contentSha256: string;
	fileReleaseId: number;
	filename: string;
	year: string | null;
}): string {
	const digest = input.contentSha256.trim().toLowerCase();
	if (!digest) {
		throw new Error("contentSha256 is required");
	}
	const year = input.year?.trim() || "unknown-year";
	return [
		INTERNAL_PORTAL_SOURCE_CHANNEL,
		`file-release-${input.fileReleaseId}`,
		year,
		`sha256-${digest}`,
		"capture",
		safeBasename(input.filename),
	].join("/");
}

async function materializeReleasedFiles(input: {
	abortSignal?: AbortSignal;
	apiContext: ApiRequestContextLike;
	artifactStore: AuthenticatedNoticeArtifactStore;
	bundleRecords: BundleFileReleaseRecord[];
	observedAt: string;
	requestMaxRetries: number;
	siteId: string;
}): Promise<{ bundleRecords: BundleFileReleaseRecord[]; uploadedCount: number }> {
	input.abortSignal?.throwIfAborted();
	const bundleRecords: BundleFileReleaseRecord[] = [];
	let uploadedCount = 0;
	const downloadRequests = input.bundleRecords.flatMap((record) => {
		const candidateUrl =
			record.released_file.final_url ??
			record.released_file.normalized_source_url ??
			record.released_file.source_url;
		if (
			!candidateUrl ||
			record.released_file.origin_scope !== "internal" ||
			record.released_file.storage_provider !== "reference_only"
		) {
			return [];
		}
		return [
			{
				attachmentUrl: candidateUrl,
				cacheKey: fileReleaseDownloadCacheKey(candidateUrl),
				fetchMode: "file_release" as const,
				siteId: input.siteId,
			},
		];
	});
	const downloadResults =
		downloadRequests.length === 0
			? new Map<string, AttachmentDownloadOutcome>()
			: await runAttachmentCrawleeDownloadOutcomes({
					abortSignal: input.abortSignal,
					apiContext: input.apiContext,
					requestMaxRetries: input.requestMaxRetries,
					requests: downloadRequests,
				});

	for (const record of input.bundleRecords) {
		input.abortSignal?.throwIfAborted();
		const candidateUrl =
			record.released_file.final_url ??
			record.released_file.normalized_source_url ??
			record.released_file.source_url;
		if (
			!candidateUrl ||
			record.released_file.origin_scope !== "internal" ||
			record.released_file.storage_provider !== "reference_only"
		) {
			bundleRecords.push(record);
			continue;
		}

		try {
			input.abortSignal?.throwIfAborted();
			const cacheKey = fileReleaseDownloadCacheKey(candidateUrl);
			const downloadOutcome = downloadResults.get(cacheKey);
			if (!downloadOutcome) {
				throw new Error(`missing file release download result:${record.file_release_id}`);
			}
			if (downloadOutcome.status === "rejected") {
				throw downloadOutcome.error;
			}
			const result: FetchAttachmentBinaryResult = downloadOutcome.result;
			const contentSha256 = sha256Hex(result.body);
			const resolvedFilename = resolveFileReleaseFilename({
				contentDisposition: result.contentDisposition,
				sourceFilename: record.file_release.upfilename,
				sourceUrl: candidateUrl,
			});
			const resolvedContentType =
				resolveReleasedFileContentType({
					contentType: result.contentType,
					filename: resolvedFilename,
				}) ?? "application/octet-stream";
			const objectKey = buildAuthenticatedNoticeFileReleaseCaptureKey({
				contentSha256,
				fileReleaseId: record.file_release_id,
				filename: resolvedFilename,
				year: inferYearLabel(record.file_release.filetime),
			});
			const stored = await input.artifactStore.createOrVerifyObject({
				abortSignal: input.abortSignal,
				objectKey,
				data: result.body,
				contentType: resolvedContentType,
				metadata: {
					"content-sha256": contentSha256,
					"source-surface": "file_release",
				},
			});
			input.abortSignal?.throwIfAborted();
			uploadedCount += 1;
			bundleRecords.push({
				...record,
				released_file: {
					...record.released_file,
					original_filename: resolvedFilename,
					mime_type: resolvedContentType,
					byte_size: stored.byteSize,
					sha256: contentSha256,
					storage_provider: input.artifactStore.storageProvider,
					bucket: stored.bucket,
					object_key: stored.objectKey,
					etag: stored.etag,
					version_id: stored.versionId,
					provenance_status: "collected_internal",
					ingest_status: "uploaded",
					downloaded_at: input.observedAt,
					uploaded_at: input.observedAt,
					updated_at: input.observedAt,
					last_error: null,
				},
			});
		} catch (error) {
			input.abortSignal?.throwIfAborted();
			const message = error instanceof Error ? error.message : String(error);
			if (isAttachmentDownloadTerminalUnavailableError(error)) {
				bundleRecords.push({
					...record,
					released_file: {
						...record.released_file,
						provenance_status: "terminal_unavailable",
						ingest_status: "terminal_unavailable",
						terminal_reason: error.terminalReason,
						last_http_status: error.lastHttpStatus,
						last_error_class: "terminal_unavailable",
						last_error: `terminal_unavailable:${error.terminalReason}`,
						updated_at: input.observedAt,
					},
				});
				continue;
			}
			throw new Error(
				[
					"file_release_materialization_failed",
					`file_release=${record.file_release_id}`,
					message,
				].join(":"),
				{ cause: error },
			);
		}
	}

	return {
		bundleRecords,
		uploadedCount,
	};
}

function fileReleaseDownloadCacheKey(candidateUrl: string): string {
	return `file_release:${candidateUrl}`;
}
