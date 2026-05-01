import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
	fetchAttachmentBinary,
	fetchFileReleaseCodeTypes,
	fetchFileReleaseDetail,
	fetchFileReleaseDownloadUrl,
	fetchFileReleaseExplainDepartments,
	fetchFileReleasePage,
	fetchFileReleaseTypes,
	isAttachmentDownloadTerminalUnavailableError,
} from "./api";
import {
	type AuthenticatedNoticeArtifactStore,
	createAuthenticatedNoticeArtifactStoreFromEnv,
	type StoredArtifactRef,
} from "./artifact-store";
import { buildCollectorRunLeaseKey } from "./collector-run-lease";
import {
	buildCollectorFileReleaseRunLedgerRecord,
	buildCollectorRunFailedLedgerRecord,
	buildCollectorRunId,
	buildCollectorRunStartedLedgerRecord,
	type CollectorRunLedgerRecord,
	type CollectorRunLedgerStore,
} from "./collector-run-ledger";
import { ensureRuntimeDirs, loadCollectorEnv, resolveCollectorConfig } from "./config";
import {
	AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
	buildExportManifest,
	classifyOriginScope,
	inferYearLabel,
	normalizeDepartments,
	normalizeNullableNumber,
	normalizeNullableText,
	normalizeObservedExplainDepartments,
	normalizeObservedFileCodeTypes,
	normalizeObservedFileTypes,
	normalizeOptionalId,
	normalizeRequiredId,
	normalizeRequiredText,
	normalizeUrlHost,
	normalizeUrlScheme,
	resolveAbsoluteUrl,
	resolveFileReleaseExportFiltersFromEnv,
	resolveFileReleaseFilename,
	resolveReleasedFileContentType,
	safeBasename,
	toTimestampLabel,
} from "./file-release-export-helpers";
import {
	buildCollectorRunLeaseStoreForMain,
	buildCollectorRunLedgerStoreForMain,
	runWithOptionalCollectorLease,
	sanitizeObjectKeySegment,
} from "./file-release-export-runtime";
import { createApiContextFromStorageState } from "./portal";
import { formatSafeErrorMessage } from "./safe-error";
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
} from "./types";

export interface CollectFileReleaseBundleInput {
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
	requestBackoffBaseMs: number;
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

export interface WriteFileReleaseArtifactsInput {
	bundleRecords: BundleFileReleaseRecord[];
	exportManifest: FileReleaseExportManifest;
	outputDir: string;
}

export interface WriteFileReleaseArtifactsResult {
	bundlePath: string;
	manifestPath: string;
}

export interface UploadFileReleaseArtifactsInput {
	artifactStore: AuthenticatedNoticeArtifactStore;
	bundleRecords: unknown[];
	exportedAt: string;
	exportManifest: unknown;
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

export interface RunFileReleaseExportInput {
	artifactStore?: AuthenticatedNoticeArtifactStore;
	collectBundle: () => Promise<CollectFileReleaseBundleResult>;
	collectorRunLedgerStore?: CollectorRunLedgerStore;
	exportedAt: string;
	outputDir?: string;
	runId?: string;
	siteId: string;
	sourceHomeUrl: string;
	writeLocalArtifacts: boolean;
}

export interface RunFileReleaseExportResult {
	ledgerRecord: CollectorRunLedgerRecord;
	result: CollectFileReleaseBundleResult;
	uploadedArtifactRefs: UploadFileReleaseArtifactsResult;
	written: WriteFileReleaseArtifactsResult | null;
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
			origin_scope: classifyOriginScope(resolvedDownloadUrl),
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
	const createApiContext =
		input.createApiContext ??
		(() => createApiContextFromStorageState(resolveCollectorConfig(process.env)));
	const apiContext = await createApiContext();
	const fetchPage =
		input.fetchFileReleasePage ??
		((pageInput) =>
			fetchFileReleasePage({
				...pageInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));
	const fetchDetail =
		input.fetchFileReleaseDetail ??
		((detailInput) =>
			fetchFileReleaseDetail({
				...detailInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));
	const fetchDownloadUrl =
		input.fetchFileReleaseDownloadUrl ??
		((detailInput) =>
			fetchFileReleaseDownloadUrl({
				...detailInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));
	const fetchTypes =
		input.fetchFileReleaseTypes ??
		((typeInput) =>
			fetchFileReleaseTypes({
				...typeInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));
	const fetchCodeTypes =
		input.fetchFileReleaseCodeTypes ??
		((typeInput) =>
			fetchFileReleaseCodeTypes({
				...typeInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));
	const fetchExplainDepartments =
		input.fetchFileReleaseExplainDepartments ??
		((deptInput) =>
			fetchFileReleaseExplainDepartments({
				...deptInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));

	const bundleMap = new Map<number, BundleFileReleaseRecord>();
	const observedDepartments = new Set<string>();
	const targetFileReleaseId = input.targetFileReleaseId ?? null;
	let detailFetched = 0;
	let fileUrlsResolved = 0;
	let itemsSeen = 0;
	let pagesFetched = 0;

	try {
		const fileTypeResponse = await fetchTypes({ apiContext });
		const observedFileTypes = normalizeObservedFileTypes(fileTypeResponse);
		const fileCodeTypeResponse = await fetchCodeTypes({ apiContext });
		const observedFileCodeTypes = normalizeObservedFileCodeTypes(fileCodeTypeResponse);
		const explainDepartmentResponse = await fetchExplainDepartments({ apiContext });
		const observedExplainDepartments =
			normalizeObservedExplainDepartments(explainDepartmentResponse);
		const fileTypeNameById = new Map(observedFileTypes.map((item) => [item.id, item.typename]));

		for (let currentPage = 1; ; currentPage += 1) {
			if (input.maxPages !== null && input.maxPages !== undefined && currentPage > input.maxPages) {
				break;
			}
			if (targetFileReleaseId !== null && bundleMap.has(targetFileReleaseId)) {
				break;
			}
			if (input.maxFileReleases && bundleMap.size >= input.maxFileReleases) {
				break;
			}

			const pageResponse = await fetchPage({
				apiContext,
				currentPage,
				pageSize: input.pageSize,
			});
			pagesFetched += 1;
			itemsSeen += pageResponse.data?.length ?? 0;
			for (const department of normalizeDepartments(pageResponse.dws)) {
				observedDepartments.add(department);
			}

			const pageItems = pageResponse.data ?? [];
			if (pageItems.length === 0) {
				break;
			}

			for (const item of pageItems) {
				const fileReleaseId = normalizeOptionalId(item.id);
				if (fileReleaseId === null || bundleMap.has(fileReleaseId)) {
					continue;
				}
				if (targetFileReleaseId !== null && fileReleaseId !== targetFileReleaseId) {
					continue;
				}
				if (input.maxFileReleases && bundleMap.size >= input.maxFileReleases) {
					break;
				}
				const detail = await fetchDetail({
					apiContext,
					fileReleaseId,
				});
				detailFetched += 1;
				const downloadUrl = await fetchDownloadUrl({
					apiContext,
					fileReleaseId,
				});
				fileUrlsResolved += 1;
				bundleMap.set(
					fileReleaseId,
					buildFileReleaseRecord({
						detail,
						downloadUrl: normalizeNullableText(downloadUrl.url),
						fileTypeNameById,
						item,
						observedAt: input.exportedAt,
						sourceHomeUrl: input.sourceHomeUrl,
					}),
				);
			}

			if (targetFileReleaseId !== null && bundleMap.has(targetFileReleaseId)) {
				break;
			}
			if (input.maxFileReleases && bundleMap.size >= input.maxFileReleases) {
				break;
			}

			if (pageItems.length < input.pageSize) {
				break;
			}
			if (
				typeof pageResponse.size === "number" &&
				currentPage * input.pageSize >= pageResponse.size
			) {
				break;
			}
		}

		const bundleRecords = [...bundleMap.values()];
		if (targetFileReleaseId !== null && !bundleMap.has(targetFileReleaseId)) {
			throw new Error(
				`target file_release_id ${targetFileReleaseId} was not found in file_release export scope`,
			);
		}
		const materialized =
			input.attachmentArtifactStore === undefined
				? {
						bundleRecords,
						uploadedCount: 0,
					}
				: await materializeReleasedFiles({
						apiContext,
						artifactStore: input.attachmentArtifactStore,
						bundleRecords,
						observedAt: input.exportedAt,
					});

		return {
			bundleRecords: materialized.bundleRecords,
			exportManifest: buildExportManifest({
				exportedAt: input.exportedAt,
				detailFetched,
				fileUrlsResolved,
				itemsInserted: materialized.bundleRecords.length,
				itemsSeen,
				maxFileReleases: input.maxFileReleases ?? null,
				maxPages: input.maxPages ?? null,
				observedExplainDepartments,
				observedFileCodeTypes,
				observedDepartments: [...observedDepartments].sort((left, right) =>
					left.localeCompare(right, "zh-Hans-CN"),
				),
				observedFileTypes,
				pageSize: input.pageSize,
				pagesFetched,
				siteId: input.siteId,
				sourceHomeUrl: input.sourceHomeUrl,
				targetFileReleaseId,
				fileStorageMode:
					input.attachmentArtifactStore === undefined ? "reference_only" : "object_store_write",
			}),
			stats: {
				detailFetched,
				fileUrlsResolved,
				fileReleasesCollected: materialized.bundleRecords.length,
				fileObjectsUploaded: materialized.uploadedCount,
				pagesFetched,
			},
		};
	} finally {
		await apiContext.dispose();
	}
}

export function writeFileReleaseArtifacts(
	input: WriteFileReleaseArtifactsInput,
): WriteFileReleaseArtifactsResult {
	fs.mkdirSync(input.outputDir, { recursive: true });
	const timestamp = toTimestampLabel(input.exportManifest.exported_at);
	const bundlePath = path.join(input.outputDir, `file-releases-bundle-${timestamp}.json`);
	const manifestPath = path.join(input.outputDir, `file-releases-manifest-${timestamp}.json`);

	fs.writeFileSync(bundlePath, `${JSON.stringify(input.bundleRecords, null, 2)}\n`, "utf-8");
	fs.writeFileSync(manifestPath, `${JSON.stringify(input.exportManifest, null, 2)}\n`, "utf-8");

	return {
		bundlePath,
		manifestPath,
	};
}

export async function uploadFileReleaseArtifacts(
	input: UploadFileReleaseArtifactsInput,
): Promise<UploadFileReleaseArtifactsResult> {
	const timestamp = toTimestampLabel(input.exportedAt);
	const prefix = [
		AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
		"runs",
		sanitizeObjectKeySegment(input.siteId),
		timestamp,
	].join("/");
	const bundleObjectKey = `${prefix}/file-releases-bundle.json`;
	const manifestObjectKey = `${prefix}/file-releases-manifest.json`;
	const bundlePayload = serializeJsonArtifactPayload(input.bundleRecords);
	const manifestPayload = serializeJsonArtifactPayload(input.exportManifest);
	const bundleRef = await input.artifactStore.putObject({
		objectKey: bundleObjectKey,
		data: bundlePayload,
		contentType: "application/json",
		metadata: {
			artifact_kind: "file_release_bundle",
			site_id: input.siteId,
			source_channel: AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
			source_surface: "file_release",
		},
	});
	const manifestRef = await input.artifactStore.putObject({
		objectKey: manifestObjectKey,
		data: manifestPayload,
		contentType: "application/json",
		metadata: {
			artifact_kind: "file_release_manifest",
			site_id: input.siteId,
			source_channel: AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
			source_surface: "file_release",
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

export async function runFileReleaseExport(
	input: RunFileReleaseExportInput,
): Promise<RunFileReleaseExportResult> {
	const runId = input.runId ?? buildCollectorRunId(input.exportedAt, input.siteId, "file_release");
	await input.collectorRunLedgerStore?.upsertRun(
		buildCollectorRunStartedLedgerRecord({
			collectionMode: "file_release_export",
			runId,
			siteId: input.siteId,
			sourceHomeUrl: input.sourceHomeUrl,
			sourceSurface: "file_release",
			startedAt: input.exportedAt,
		}),
	);
	let terminalLedgerWritten = false;
	try {
		const result = await input.collectBundle();
		const written = input.writeLocalArtifacts
			? writeFileReleaseArtifacts({
					bundleRecords: result.bundleRecords,
					exportManifest: result.exportManifest,
					outputDir: input.outputDir ?? process.cwd(),
				})
			: null;
		if (!input.artifactStore) {
			throw new Error("authenticated notice source-bucket artifact store is required");
		}
		const uploadedArtifactRefs = await uploadFileReleaseArtifacts({
			artifactStore: input.artifactStore,
			bundleRecords: result.bundleRecords,
			exportedAt: input.exportedAt,
			exportManifest: result.exportManifest,
			siteId: input.siteId,
		});
		const ledgerRecord = buildCollectorFileReleaseRunLedgerRecord({
			bundleArtifactRef: uploadedArtifactRefs.bundleRef,
			bundleObjectKey: uploadedArtifactRefs.bundleObjectKey,
			bundlePath: written?.bundlePath ?? null,
			bundleRecords: result.bundleRecords,
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
					collectionMode: "file_release_export",
					failureReason: formatSafeErrorMessage(error),
					finishedAt: new Date().toISOString(),
					runId,
					siteId: input.siteId,
					sourceHomeUrl: input.sourceHomeUrl,
					sourceSurface: "file_release",
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
		AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
		`file-release-${input.fileReleaseId}`,
		year,
		`sha256-${digest}`,
		"capture",
		safeBasename(input.filename),
	].join("/");
}

async function materializeReleasedFiles(input: {
	apiContext: ApiRequestContextLike;
	artifactStore: AuthenticatedNoticeArtifactStore;
	bundleRecords: BundleFileReleaseRecord[];
	observedAt: string;
}): Promise<{ bundleRecords: BundleFileReleaseRecord[]; uploadedCount: number }> {
	const bundleRecords: BundleFileReleaseRecord[] = [];
	let uploadedCount = 0;

	for (const record of input.bundleRecords) {
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
			const result = await fetchAttachmentBinary({
				apiContext: input.apiContext,
				attachmentUrl: candidateUrl,
				requestBackoffBaseMs: 1,
				requestMaxRetries: 1,
			});
			const contentSha256 = createHash("sha256").update(result.body).digest("hex");
			const resolvedFilename = resolveFileReleaseFilename({
				contentDisposition: result.contentDisposition,
				fallbackFilename: record.file_release.upfilename,
				fallbackUrl: candidateUrl,
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
			const stored = await input.artifactStore.putObject({
				objectKey,
				data: result.body,
				contentType: resolvedContentType,
				metadata: {
					"content-sha256": contentSha256,
					"source-surface": "file_release",
				},
			});
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
			bundleRecords.push({
				...record,
				released_file: {
					...record.released_file,
					last_error: message,
					last_error_class: "transient_failed",
					updated_at: input.observedAt,
				},
			});
		}
	}

	return {
		bundleRecords,
		uploadedCount,
	};
}

export async function main(): Promise<void> {
	loadCollectorEnv();
	const config = resolveCollectorConfig(process.env);
	ensureRuntimeDirs(config);
	const exportedAt = new Date().toISOString();
	const attachmentArtifactStore = createAuthenticatedNoticeArtifactStoreFromEnv(process.env);
	const collectorRunLedgerStore = buildCollectorRunLedgerStoreForMain(config);
	const collectorRunLeaseStore = buildCollectorRunLeaseStoreForMain(config);
	const { pageSize, maxPages, maxFileReleases, targetFileReleaseId } =
		resolveFileReleaseExportFiltersFromEnv(process.env);
	try {
		await runWithOptionalCollectorLease(
			collectorRunLeaseStore,
			{
				leaseKey: buildCollectorRunLeaseKey({
					siteId: config.siteId,
					sourceSurface: "file_release",
				}),
				now: exportedAt,
				ownerId: `${config.siteId}:file_release:${toTimestampLabel(exportedAt)}`,
				ttlSeconds: config.collectorRunLeaseTtlSeconds,
			},
			async () => {
				const runResult = await runFileReleaseExport({
					artifactStore: attachmentArtifactStore,
					collectBundle: () =>
						collectFileReleaseBundle({
							attachmentArtifactStore,
							exportedAt,
							maxFileReleases,
							maxPages,
							pageSize,
							requestBackoffBaseMs: config.requestBackoffBaseMs,
							requestMaxRetries: config.requestMaxRetries,
							siteId: config.siteId,
							sourceHomeUrl: config.sourceHomeUrl,
							targetFileReleaseId,
						}),
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
		await collectorRunLedgerStore?.dispose();
		await collectorRunLeaseStore?.dispose();
	}
}
